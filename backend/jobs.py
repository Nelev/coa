import json
import os
import shutil
import time
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import BinaryIO

import psycopg
from alembic import command
from alembic.config import Config
from langgraph.checkpoint.postgres import PostgresSaver
from psycopg.conninfo import make_conninfo
from psycopg.rows import dict_row
from psycopg.sql import SQL, Identifier

# what a listing returns: everything but the (large) spec, and the ordering column
SUMMARY = (
    "id, filename, status, statuses, error, started_at, result, finished_at, decision, decided_by, decided_at, reason, "
    "owner, input_tokens, output_tokens, cost_usd, question, answer"
)


def in_schema(dsn: str, schema: str) -> str:
    """`dsn` with the search_path of `schema`: the tables a connection creates, and finds by their bare name, are the schema's."""
    return make_conninfo(dsn, options=f"-csearch_path={schema}")


@contextmanager
def open_checkpointer(dsn: str) -> Iterator[PostgresSaver]:
    """The agent's checkpointer, in its own schema (CHECKPOINT_SCHEMA, default `langgraph`), created with its tables when missing.

    PostgresSaver has no schema option: it creates its tables where the connection's search_path points.
    """
    schema = os.getenv("CHECKPOINT_SCHEMA") or "langgraph"
    with psycopg.connect(dsn, autocommit=True) as db:
        db.execute(SQL("CREATE SCHEMA IF NOT EXISTS {}").format(Identifier(schema)))
    with PostgresSaver.from_conn_string(in_schema(dsn, schema)) as checkpointer:
        checkpointer.setup()  # nothing happens when the tables exist
        yield checkpointer


def _now() -> int:
    return int(time.time() * 1000)


def _usage_columns(usage: dict) -> tuple:
    """The run's totals from the agent's state, as the usage columns hold them. These cover the whole run, restarts included, because
    the checkpoint adds the model calls up; a run that made no call yet has none (null)."""
    return usage.get("input_tokens"), usage.get("output_tokens"), usage.get("cost")


def _job(row: dict) -> dict:
    job = dict(row)
    job["statuses"] = json.loads(job["statuses"])
    for column in ("result", "question", "answer"):
        if job[column] is not None:
            job[column] = json.loads(job[column])
    if job.get("ui_spec") is not None:
        job["ui_spec"] = json.loads(job["ui_spec"])
    return job


class Jobs:
    """The analysis jobs, kept in Postgres (DATABASE_URL, the `runs` table) with the uploaded PDFs under `directory`.

    A job is queued, running, needs_input (the agent paused to ask a person), done or error; once done it can also carry a
    person's decision. The table is the source of truth: the in-memory queue in main.py is rebuilt from it.
    """

    def __init__(self, directory: Path):
        self.uploads = directory / "uploads"
        self.uploads.mkdir(parents=True, exist_ok=True)
        dsn = os.getenv("DATABASE_URL")
        if not dsn:
            raise RuntimeError("the database is not configured: set DATABASE_URL")
        self.dsn = dsn
        # creates the tables, or brings them up to date: see migrations/
        command.upgrade(Config(Path(__file__).parent / "alembic.ini"), "head")

    def _execute(self, query: str, args: tuple = ()) -> list[dict]:
        # one short-lived connection per call, so no connection is shared between threads
        with psycopg.connect(self.dsn, row_factory=dict_row) as db:  # leaving the block commits and closes
            cursor = db.execute(query, args)
            return cursor.fetchall() if cursor.description else []  # an UPDATE without RETURNING has no rows

    def pdf_path(self, job_id: str) -> Path:
        return self.uploads / f"{job_id}.pdf"

    def upsert_user(self, user_id: str, email: str | None = None, name: str | None = None) -> None:
        """Record the person who signs in (their id, and their email and name when the token carries them): their runs point to them."""
        query = (
            "INSERT INTO users (id, email, name) VALUES (%s, %s, %s) "
            "ON CONFLICT (id) DO UPDATE SET email = COALESCE(EXCLUDED.email, users.email), name = COALESCE(EXCLUDED.name, users.name)"
        )
        self._execute(query, (user_id, email, name))

    def create(self, filename: str, pdf: BinaryIO, owner: str | None = None) -> str:
        """Store the PDF and add a queued job for it, owned by the person who uploaded it (their sign-in id).

        Returns the job id, which is also the agent's thread id. Jobs from before owners were recorded have none.
        The owner has to be a user: see `upsert_user`.
        """
        job_id = uuid.uuid4().hex
        with self.pdf_path(job_id).open("wb") as saved:
            shutil.copyfileobj(pdf, saved)
        self._execute("INSERT INTO runs (id, filename, status, owner) VALUES (%s, %s, 'queued', %s)", (job_id, filename, owner))
        return job_id

    def _with_pdf(self, row: dict) -> dict:
        job = _job(row)
        job["has_pdf"] = self.pdf_path(job["id"]).exists()  # jobs from before the PDFs were kept have none
        return job

    def get(self, job_id: str, with_spec: bool = True) -> dict | None:
        """One job, with its report unless `with_spec` is False (the report is the large part)."""
        columns = f"{SUMMARY}, ui_spec" if with_spec else SUMMARY
        rows = self._execute(f"SELECT {columns} FROM runs WHERE id = %s", (job_id,))
        return self._with_pdf(rows[0]) if rows else None

    def all(self) -> list[dict]:
        return [self._with_pdf(row) for row in self._execute(f"SELECT {SUMMARY} FROM runs ORDER BY seq")]

    def start(self, job_id: str, keep_statuses: bool = False) -> None:
        """Mark the job running. A run that starts over drops the statuses of its earlier attempt; one that resumes keeps them."""
        reset = "" if keep_statuses else ", statuses = '[]'"
        sql = f"UPDATE runs SET status = 'running', question = NULL, started_at = COALESCE(started_at, %s){reset} WHERE id = %s"
        self._execute(sql, (_now(), job_id))

    def wait_for_input(self, job_id: str, question: dict) -> None:
        """The agent paused to ask a person: the job waits, with the question, until `answer` is called. No worker is held meanwhile."""
        self._execute("UPDATE runs SET status = 'needs_input', question = %s, answer = NULL WHERE id = %s", (json.dumps(question), job_id))

    def answer(self, job_id: str, answer: dict) -> bool:
        """Record a person's reply and queue the job to continue. False if the job is not waiting for one (or another reply won)."""
        sql = "UPDATE runs SET status = 'queued', answer = %s WHERE id = %s AND status = 'needs_input' RETURNING id"
        return bool(self._execute(sql, (json.dumps(answer), job_id)))  # one statement: two people cannot both answer

    def add_status(self, job_id: str, text: str) -> None:
        self._execute("UPDATE runs SET statuses = (statuses::jsonb || to_jsonb(%s::text))::text WHERE id = %s", (text, job_id))

    def finish(self, job_id: str, ui_spec: dict, result: dict | None, usage: dict) -> None:
        sql = (
            "UPDATE runs SET status = 'done', ui_spec = %s, result = %s, finished_at = %s, "
            "input_tokens = %s, output_tokens = %s, cost_usd = %s WHERE id = %s"
        )
        self._execute(sql, (json.dumps(ui_spec), None if result is None else json.dumps(result), _now(), *_usage_columns(usage), job_id))

    def decide(self, job_id: str, decision: str, by: str, reason: str) -> bool:
        """Record a person's decision on a finished job. False if the job is not done or already has a final decision."""
        sql = (
            "UPDATE runs SET decision = %s, decided_by = %s, decided_at = %s, reason = %s "
            "WHERE id = %s AND status = 'done' AND (decision IS NULL OR decision = 'on_hold') RETURNING id"
        )
        return bool(self._execute(sql, (decision, by, _now(), reason, job_id)))  # one statement: two people cannot both win

    def fail(self, job_id: str, message: str, usage: dict) -> None:
        sql = (
            "UPDATE runs SET status = 'error', error = %s, finished_at = %s, "
            "input_tokens = %s, output_tokens = %s, cost_usd = %s WHERE id = %s"
        )
        self._execute(sql, (message, _now(), *_usage_columns(usage), job_id))

    def requeue_unfinished(self) -> list[str]:
        """After a restart: the jobs that were running go back to queued. Returns the ids of all queued jobs, oldest first."""
        self._execute("UPDATE runs SET status = 'queued' WHERE status = 'running'")
        return [row["id"] for row in self._execute("SELECT id FROM runs WHERE status = 'queued' ORDER BY seq")]
