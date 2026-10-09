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
    started_at INTEGER
)
"""
# what a listing returns: everything but the (large) spec
SUMMARY = "id, filename, status, statuses, error, started_at"


def _now() -> int:
    return int(time.time() * 1000)


def _job(row: sqlite3.Row) -> dict:
    job = dict(row)
    job["statuses"] = json.loads(job["statuses"])
    if job.get("ui_spec") is not None:
        job["ui_spec"] = json.loads(job["ui_spec"])
    return job


class Jobs:
    """The analysis jobs, kept in SQLite under `directory` along with the uploaded PDFs of the jobs that have not finished.

    A job is queued, running, done or error. The table is the source of truth: the in-memory queue in main.py is rebuilt from it.
    """

    def __init__(self, directory: Path):
        self.uploads = directory / "uploads"
        self.uploads.mkdir(parents=True, exist_ok=True)
        self.db_path = directory / "jobs.db"
        self._execute("PRAGMA journal_mode=WAL")  # readers don't block the workers' writes
        self._execute(SCHEMA)

    def _execute(self, sql: str, args: tuple = ()) -> list[sqlite3.Row]:
        # one short-lived connection per call, so no connection is shared between threads
        with closing(sqlite3.connect(self.db_path, timeout=10)) as db, db:  # `db` as a context manager commits
            db.row_factory = sqlite3.Row
            return db.execute(sql, args).fetchall()

    def pdf_path(self, job_id: str) -> Path:
        return self.uploads / f"{job_id}.pdf"

    def create(self, filename: str, pdf: BinaryIO) -> str:
        """Store the PDF and add a queued job for it; returns the job id, which is also the agent's thread id."""
        job_id = uuid.uuid4().hex
        with self.pdf_path(job_id).open("wb") as saved:
            shutil.copyfileobj(pdf, saved)
        self._execute("INSERT INTO jobs (id, filename, status) VALUES (?, ?, 'queued')", (job_id, filename))
        return job_id

    def get(self, job_id: str) -> dict | None:
        rows = self._execute(f"SELECT {SUMMARY}, ui_spec FROM jobs WHERE id = ?", (job_id,))
        return _job(rows[0]) if rows else None

    def all(self) -> list[dict]:
        return [_job(row) for row in self._execute(f"SELECT {SUMMARY} FROM jobs ORDER BY rowid")]

    def start(self, job_id: str, keep_statuses: bool = False) -> None:
        """Mark the job running. A run that starts over drops the statuses of its earlier attempt; one that resumes keeps them."""
        reset = "" if keep_statuses else ", statuses = '[]'"
        self._execute(f"UPDATE jobs SET status = 'running', started_at = COALESCE(started_at, ?){reset} WHERE id = ?", (_now(), job_id))

    def add_status(self, job_id: str, text: str) -> None:
        self._execute("UPDATE jobs SET statuses = json_insert(statuses, '$[#]', ?) WHERE id = ?", (text, job_id))

    def finish(self, job_id: str, ui_spec: dict) -> None:
        self._execute("UPDATE jobs SET status = 'done', ui_spec = ? WHERE id = ?", (json.dumps(ui_spec), job_id))

    def fail(self, job_id: str, message: str) -> None:
        self._execute("UPDATE jobs SET status = 'error', error = ? WHERE id = ?", (message, job_id))

    def requeue_unfinished(self) -> list[str]:
        """After a restart: the jobs that were running go back to queued. Returns the ids of all queued jobs, oldest first."""
        self._execute("UPDATE jobs SET status = 'queued' WHERE status = 'running'")
        return [row["id"] for row in self._execute("SELECT id FROM jobs WHERE status = 'queued' ORDER BY rowid")]
