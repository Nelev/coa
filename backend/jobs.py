import json
import shutil
import sqlite3
import time
import uuid
from contextlib import closing
from pathlib import Path
from typing import BinaryIO

SCHEMA = """
CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    filename TEXT NOT NULL,
    status TEXT NOT NULL,
    statuses TEXT NOT NULL DEFAULT '[]',
    ui_spec TEXT,
    error TEXT,
    started_at INTEGER,
    result TEXT,
    finished_at INTEGER
)
"""
# columns added after the first version: an existing database gets them when it is opened
ADDED_COLUMNS = {
    "result": "TEXT",
    "finished_at": "INTEGER",
    "decision": "TEXT",
    "decided_by": "TEXT",
    "decided_at": "INTEGER",
    "reason": "TEXT",
    "owner": "TEXT",
    "input_tokens": "INTEGER",
    "output_tokens": "INTEGER",
    "cost_usd": "REAL",
}
# what a listing returns: everything but the (large) spec
SUMMARY = "id, filename, status, statuses, error, started_at, " + ", ".join(ADDED_COLUMNS)


def _now() -> int:
    return int(time.time() * 1000)


def _job(row: sqlite3.Row) -> dict:
    job = dict(row)
    job["statuses"] = json.loads(job["statuses"])
    if job["result"] is not None:
        job["result"] = json.loads(job["result"])
    if job.get("ui_spec") is not None:
        job["ui_spec"] = json.loads(job["ui_spec"])
    return job


class Jobs:
    """The analysis jobs, kept in SQLite under `directory` along with the uploaded PDFs.

    A job is queued, running, done or error; once done it can also carry a person's decision. The table is the source of
    truth: the in-memory queue in main.py is rebuilt from it.
    """

    def __init__(self, directory: Path):
        self.uploads = directory / "uploads"
        self.uploads.mkdir(parents=True, exist_ok=True)
        self.db_path = directory / "jobs.db"
        self._execute("PRAGMA journal_mode=WAL")  # readers don't block the workers' writes
        self._execute(SCHEMA)
        existing = {row["name"] for row in self._execute("PRAGMA table_info(jobs)")}
        for column, kind in ADDED_COLUMNS.items():
            if column not in existing:
                self._execute(f"ALTER TABLE jobs ADD COLUMN {column} {kind}")

    def _execute(self, sql: str, args: tuple = ()) -> list[sqlite3.Row]:
        # one short-lived connection per call, so no connection is shared between threads
        with closing(sqlite3.connect(self.db_path, timeout=10)) as db, db:  # `db` as a context manager commits
            db.row_factory = sqlite3.Row
            return db.execute(sql, args).fetchall()

    def pdf_path(self, job_id: str) -> Path:
        return self.uploads / f"{job_id}.pdf"

    def create(self, filename: str, pdf: BinaryIO, owner: str | None = None) -> str:
        """Store the PDF and add a queued job for it, owned by the person who uploaded it (their sign-in id).

        Returns the job id, which is also the agent's thread id. Jobs from before owners were recorded have none.
        """
        job_id = uuid.uuid4().hex
        with self.pdf_path(job_id).open("wb") as saved:
            shutil.copyfileobj(pdf, saved)
        self._execute("INSERT INTO jobs (id, filename, status, owner) VALUES (?, ?, 'queued', ?)", (job_id, filename, owner))
        return job_id

    def _with_pdf(self, row: sqlite3.Row) -> dict:
        job = _job(row)
        job["has_pdf"] = self.pdf_path(job["id"]).exists()  # jobs from before the PDFs were kept have none
        return job

    def get(self, job_id: str, with_spec: bool = True) -> dict | None:
        """One job, with its report unless `with_spec` is False (the report is the large part)."""
        columns = f"{SUMMARY}, ui_spec" if with_spec else SUMMARY
        rows = self._execute(f"SELECT {columns} FROM jobs WHERE id = ?", (job_id,))
        return self._with_pdf(rows[0]) if rows else None

    def all(self) -> list[dict]:
        return [self._with_pdf(row) for row in self._execute(f"SELECT {SUMMARY} FROM jobs ORDER BY rowid")]

    def start(self, job_id: str, keep_statuses: bool = False) -> None:
        """Mark the job running. A run that starts over drops the statuses of its earlier attempt; one that resumes keeps them."""
        reset = "" if keep_statuses else ", statuses = '[]'"
        self._execute(f"UPDATE jobs SET status = 'running', started_at = COALESCE(started_at, ?){reset} WHERE id = ?", (_now(), job_id))

    def add_status(self, job_id: str, text: str) -> None:
        self._execute("UPDATE jobs SET statuses = json_insert(statuses, '$[#]', ?) WHERE id = ?", (text, job_id))

    def add_usage(self, job_id: str, input_tokens: int, output_tokens: int, cost: float | None) -> None:
        """Add one model call's usage to the job's totals. Every call is added as it ends, so a run that a restart interrupted keeps
        what its finished calls spent, and a call that runs again after the restart is counted again: it was paid for twice. A call the
        restart killed midway never ends, so it is not counted. The cost stays unknown (None) until a call reports one."""
        sql = (
            "UPDATE jobs SET input_tokens = COALESCE(input_tokens, 0) + ?, output_tokens = COALESCE(output_tokens, 0) + ?, "
            "cost_usd = CASE WHEN ? IS NULL THEN cost_usd ELSE COALESCE(cost_usd, 0) + ? END WHERE id = ?"
        )
        self._execute(sql, (input_tokens, output_tokens, cost, cost, job_id))

    def finish(self, job_id: str, ui_spec: dict, result: dict | None) -> None:
        sql = "UPDATE jobs SET status = 'done', ui_spec = ?, result = ?, finished_at = ? WHERE id = ?"
        self._execute(sql, (json.dumps(ui_spec), None if result is None else json.dumps(result), _now(), job_id))

    def decide(self, job_id: str, decision: str, by: str, reason: str) -> bool:
        """Record a person's decision on a finished job. False if the job is not done or already has a final decision."""
        sql = (
            "UPDATE jobs SET decision = ?, decided_by = ?, decided_at = ?, reason = ? "
            "WHERE id = ? AND status = 'done' AND (decision IS NULL OR decision = 'on_hold') RETURNING id"
        )
        return bool(self._execute(sql, (decision, by, _now(), reason, job_id)))  # one statement: two people cannot both win

    def fail(self, job_id: str, message: str) -> None:
        self._execute("UPDATE jobs SET status = 'error', error = ?, finished_at = ? WHERE id = ?", (message, _now(), job_id))

    def requeue_unfinished(self) -> list[str]:
        """After a restart: the jobs that were running go back to queued. Returns the ids of all queued jobs, oldest first."""
        self._execute("UPDATE jobs SET status = 'queued' WHERE status = 'running'")
        return [row["id"] for row in self._execute("SELECT id FROM jobs WHERE status = 'queued' ORDER BY rowid")]
