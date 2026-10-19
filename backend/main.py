import logging
import os
import queue
import threading
from contextlib import asynccontextmanager, suppress
from pathlib import Path
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, FastAPI, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from langgraph.types import Command
from pydantic import BaseModel

import memory
from auth import require_user
from jobs import Jobs, open_checkpointer
from react_agent.react_agent import graph
from schema.schema import Scope

logger = logging.getLogger(__name__)

DEFAULT_DATA_DIR = Path(__file__).resolve().parent / "data"

RECURSION_LIMIT = 40  # graph steps a run may take: the model decides how many, a normal check takes about 18

# set when the app starts: the jobs table, the agent with its checkpointer, and the queue of job ids the workers take from
store: Jobs
agent_app = None
pending: queue.Queue


def waiting_question(snapshot) -> dict | None:
    """What a paused run asks a person (the interrupt's id and its questions), or None when it is not paused."""
    return {"id": snapshot.interrupts[0].id, **snapshot.interrupts[0].value} if snapshot.interrupts else None


def run_job(job_id: str) -> None:
    """Run the agent on a job's PDF, recording each node's status and, at the end, the UI spec or the error.

    The job id is the agent's thread id: the checkpointer saves the run's state under it after every node, so a run
    that a restart interrupted continues after its last finished node instead of starting over.

    A run can also pause to ask a person (an interrupt): the job then waits as needs_input and the worker is free. POST
    /jobs/{id}/answer queues it again, and the run continues with the answer, which is also what a restart does with a job
    that was answered but not finished.
    """
    config = {"configurable": {"thread_id": job_id}, "recursion_limit": RECURSION_LIMIT}
    values = {}
    try:
        snapshot = agent_app.get_state(config)
        job = store.get(job_id, with_spec=False)
        waiting, answer = waiting_question(snapshot), job["answer"]
        if waiting and not (answer and answer["for"] == waiting["id"]):  # asking, and no answer to this question yet
            store.wait_for_input(job_id, waiting)
            return
        resume = bool(snapshot.values)  # a checkpoint exists: continue after it (nothing runs if the run had finished)
        store.start(job_id, keep_statuses=resume)
        if waiting:
            inputs = Command(resume={"answers": answer["answers"], "by": answer["by"], "remember": answer.get("remember", {})})
        elif resume:
            inputs = None
        else:
            inputs = {"document_path": str(store.pdf_path(job_id)), "filename": job["filename"], "job_id": job_id}
        for update in agent_app.stream(inputs, config, stream_mode="custom"):  # what the nodes report with their stream writer
            store.add_status(job_id, update["status"])
        snapshot = agent_app.get_state(config)  # the last nodes' output, saved in the checkpoint
        if waiting := waiting_question(snapshot):  # the run stopped to ask a person
            store.wait_for_input(job_id, waiting)
            return
        values = snapshot.values
        if values.get("ui_spec") is None:
            raise RuntimeError("the agent finished without a report")
        store.finish(job_id, values["ui_spec"], values.get("result"), values)
    except Exception as error:
        if not values:  # the run failed before its state was read; it still paid for the calls it made
            with suppress(Exception):
                values = agent_app.get_state(config).values
        store.fail(job_id, str(error) or type(error).__name__, values)


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

    memory.vector_store()  # makes the memory's tables now, not in the middle of a run
    with open_checkpointer(store.dsn) as checkpointer:
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
app.add_middleware(CORSMiddleware, allow_origins=origins, allow_methods=["GET", "POST"], allow_headers=["Authorization"])


@app.get("/health")
async def health():
    return {"status": "ok"}


# everything about jobs needs a signed-in person; /health stays open for whatever watches the server
router = APIRouter(dependencies=[Depends(require_user)])


@router.post("/jobs", status_code=202)
def create_job(file: UploadFile, user: Annotated[dict, Depends(require_user)]):
    """Queue the agent to analyze an uploaded CoA PDF. Poll GET /jobs/{id} for its progress and result."""
    store.upsert_user(user["sub"], user.get("email"), user.get("name"))  # the run points to its owner
    job_id = store.create(file.filename or "document.pdf", file.file, owner=user["sub"])
    job = store.get(job_id)  # before a worker can take it, so the answer is still "queued"
    pending.put(job_id)
    return job


@router.get("/jobs")
def list_jobs():
    """Every job, oldest first, with the statuses its nodes reported; the report itself is in GET /jobs/{id}."""
    return store.all()


@router.get("/jobs/{job_id}")
def get_job(job_id: str):
    """One job: its status (queued, running, needs_input, done or error), the node statuses so far, and `ui_spec` once it is done.

    A needs_input job carries `question`: what the agent asks, to be answered with POST /jobs/{id}/answer."""
    job = store.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="no such job")
    return job


@router.get("/jobs/{job_id}/pdf")
def get_pdf(job_id: str):
    """The uploaded certificate, to open next to its report."""
    job = store.get(job_id, with_spec=False)
    if job is None or not job["has_pdf"]:
        raise HTTPException(status_code=404, detail="no such document")
    return FileResponse(store.pdf_path(job_id), media_type="application/pdf", filename=job["filename"], content_disposition_type="inline")


class Answer(BaseModel):
    answers: dict[str, str]  # test name -> the answer; a test left out or blank keeps the agent's verdict
    by: str
    remember: dict[str, Scope] = {}  # test name -> who the answer is kept for; a test left out gets the default, DEFAULT_SCOPE


@router.post("/jobs/{job_id}/answer")
def answer_job(job_id: str, body: Answer):
    """Answer what a paused agent asked (the job's `question`); the job is queued again and the agent continues with it."""
    job = store.get(job_id, with_spec=False)
    if job is None:
        raise HTTPException(status_code=404, detail="no such job")
    by = body.by.strip()
    if not by:
        raise HTTPException(status_code=422, detail="say who answers")
    if job["status"] != "needs_input":
        raise HTTPException(status_code=409, detail="the agent is not waiting for an answer")
    question = job["question"]
    unknown = (set(body.answers) | set(body.remember)) - {q["test"] for q in question["questions"]}
    if unknown:
        raise HTTPException(status_code=422, detail=f"not a question asked: {', '.join(sorted(unknown))}")
    if not store.answer(job_id, {"for": question["id"], "answers": body.answers, "by": by, "remember": body.remember}):
        raise HTTPException(status_code=409, detail="the agent is not waiting for an answer")
    pending.put(job_id)
    return store.get(job_id, with_spec=False)


class Decision(BaseModel):
    decision: Literal["approved", "rejected", "on_hold"]
    by: str
    reason: str = ""


@router.post("/jobs/{job_id}/decision")
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


app.include_router(router)
