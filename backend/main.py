import logging
import os
import queue
import threading
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from langgraph.checkpoint.sqlite import SqliteSaver

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
        spec = agent_app.get_state(config).values.get("ui_spec")  # the last node's output, saved in the checkpoint
        if spec is None:
            raise RuntimeError("the agent finished without a report")
        store.finish(job_id, spec)
    except Exception as error:
        store.fail(job_id, str(error) or type(error).__name__)
    finally:
        store.pdf_path(job_id).unlink(missing_ok=True)


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
# local development: the Next.js dev server calls this API straight from the browser
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:3000"], allow_methods=["GET", "POST"])


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.post("/jobs", status_code=202)
def create_job(file: UploadFile):
    """Queue the agent to analyze an uploaded CoA PDF. Poll GET /jobs/{id} for its progress and result."""
    job_id = store.create(file.filename or "document.pdf", file.file)
    pending.put(job_id)
    return store.get(job_id)


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
