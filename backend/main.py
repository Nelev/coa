import logging
import os
import queue
import threading
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from langgraph.checkpoint.sqlite import SqliteSaver
from pydantic import BaseModel

from agent.agent import graph
from jobs import Jobs

logger = logging.getLogger(__name__)

DEFAULT_DATA_DIR = Path(__file__).resolve().parent / "data"

# set when the app starts: the jobs table, the agent with its checkpointer, and the queue of job ids the workers take from
store: Jobs
agent_app = None
pending: queue.Queue


def run_job(job_id: str) -> None:
    """Run the agent on a job's PDF, recording each node's status and, at the end, the UI spec or the error.

    The job id is the agent's thread id: the checkpointer saves the run's state under it after every node, so a run
    that a restart interrupted continues after its last finished node instead of starting over.
    """
    config = {"configurable": {"thread_id": job_id}}
    try:
        resume = bool(agent_app.get_state(config).values)  # a checkpoint exists: continue after it (nothing runs if the run had finished)
        store.start(job_id, keep_statuses=resume)
        inputs = None if resume else {"document_path": str(store.pdf_path(job_id))}
        for update in agent_app.stream(inputs, config, stream_mode="custom"):  # what the nodes report with their stream writer
            store.add_status(job_id, update["status"])
        values = agent_app.get_state(config).values  # the last nodes' output, saved in the checkpoint
        if values.get("ui_spec") is None:
            raise RuntimeError("the agent finished without a report")
        store.finish(job_id, values["ui_spec"], values.get("result"))
    except Exception as error:
        store.fail(job_id, str(error) or type(error).__name__)


def worker() -> None:
    while (job_id := pending.get()) is not None:  # None tells the worker to stop
        try:
            run_job(job_id)
        except Exception:  # the job could not even be marked as failed; keep the worker alive for the next one
            logger.exception("job %s", job_id)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    global store, agent_app, pending
    data_dir = Path(os.getenv("JOBS_DIR") or DEFAULT_DATA_DIR)
    store = Jobs(data_dir)
    pending = queue.Queue()

    with SqliteSaver.from_conn_string(str(data_dir / "checkpoints.db")) as checkpointer:
        agent_app = graph.compile(checkpointer=checkpointer)

        # the queue lives in memory, the jobs in the database: after a restart, unfinished jobs are queued again
        for job_id in store.requeue_unfinished():
            pending.put(job_id)
        # daemon threads: a shutdown does not wait minutes for a running agent; its job is resumed on the next start
        workers = [threading.Thread(target=worker, daemon=True) for _ in range(int(os.getenv("MAX_CONCURRENT_RUNS", "2")))]
        for thread in workers:
            thread.start()
        yield
        for _ in workers:
            pending.put(None)


app = FastAPI(lifespan=lifespan)
# local development: the Next.js dev server calls this API straight from the browser (CORS_ORIGINS: comma-separated, to allow another)
origins = os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",")
app.add_middleware(CORSMiddleware, allow_origins=origins, allow_methods=["GET", "POST"])


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.post("/jobs", status_code=202)
def create_job(file: UploadFile):
    """Queue the agent to analyze an uploaded CoA PDF. Poll GET /jobs/{id} for its progress and result."""
    job_id = store.create(file.filename or "document.pdf", file.file)
    job = store.get(job_id)  # before a worker can take it, so the answer is still "queued"
    pending.put(job_id)
    return job


@app.get("/jobs")
def list_jobs():
    """Every job, oldest first, with the statuses its nodes reported; the report itself is in GET /jobs/{id}."""
    return store.all()


@app.get("/jobs/{job_id}")
def get_job(job_id: str):
    """One job: its status (queued, running, done or error), the node statuses so far, and `ui_spec` once it is done."""
    job = store.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="no such job")
    return job


@app.get("/jobs/{job_id}/pdf")
def get_pdf(job_id: str):
    """The uploaded certificate, to open next to its report."""
    job = store.get(job_id, with_spec=False)
    if job is None or not job["has_pdf"]:
        raise HTTPException(status_code=404, detail="no such document")
    return FileResponse(store.pdf_path(job_id), media_type="application/pdf", filename=job["filename"], content_disposition_type="inline")


class Decision(BaseModel):
    decision: Literal["approved", "rejected", "on_hold"]
    by: str
    reason: str = ""


@app.post("/jobs/{job_id}/decision")
def decide_job(job_id: str, body: Decision):
    """Record a person's decision on a finished analysis: approved, rejected or on_hold.

    A reason is required to reject or hold, and to approve a lot the agent did not find conforming (an override).
    Approved and rejected are final; a lot on hold can be decided again.
    """
    job = store.get(job_id, with_spec=False)
    if job is None:
        raise HTTPException(status_code=404, detail="no such job")
    by, reason = body.by.strip(), body.reason.strip()
    if not by:
        raise HTTPException(status_code=422, detail="say who decides")
    needs_reason = body.decision != "approved" or (job["result"] or {}).get("outcome") != "Conforming"  # rejecting, holding, overriding
    if needs_reason and not reason:
        raise HTTPException(status_code=422, detail="a reason is required to reject, hold or approve a lot that does not conform")
    if job["status"] != "done":
        raise HTTPException(status_code=409, detail="the analysis has not finished")
    if not store.decide(job_id, body.decision, by, reason):
        raise HTTPException(status_code=409, detail="this lot already has a final decision")
    return store.get(job_id, with_spec=False)
