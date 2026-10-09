import io
import threading
import time
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from langgraph.checkpoint.sqlite import SqliteSaver

import main
from agent.agent import DOCS_DIR, graph
from jobs import Jobs
from schema.schema import DocumentCheck

SPEC = {"root": "a", "elements": {"a": {"type": "Text", "props": {"text": "hi"}, "children": []}}}
CITRIC_ACID_PDF = (DOCS_DIR / "sample_coa_citric_acid.pdf").read_bytes()


class FakeAgent:
    """Stands in for the compiled graph: `stream` reports the given statuses, after which `get_state` holds the spec."""

    def __init__(self, *statuses, spec=SPEC):
        self.statuses, self.spec = statuses, spec
        self.calls = []
        self.finished = set()  # thread ids

    def get_state(self, config):
        done = config["configurable"]["thread_id"] in self.finished and self.spec is not None
        return SimpleNamespace(values={"ui_spec": self.spec} if done else {})

    def stream(self, inputs, config, stream_mode):
        assert stream_mode == "custom"
        self.calls.append((inputs, config))
        yield from self.play(inputs)
        self.finished.add(config["configurable"]["thread_id"])

    def play(self, inputs):
        for text in self.statuses:
            yield {"status": text}


@pytest.fixture
def start_app(tmp_path, monkeypatch):
    """Starts the app (its lifespan) with the jobs in tmp_path; the app is stopped after the test."""
    monkeypatch.setenv("JOBS_DIR", str(tmp_path))
    clients = []

    def start(max_runs=2):
        monkeypatch.setenv("MAX_CONCURRENT_RUNS", str(max_runs))
        client = TestClient(main.app)
        client.__enter__()
        clients.append(client)
        return client

    yield start
    for client in clients:
        client.__exit__(None, None, None)


def submit(client, content=b"%PDF-fake", name="coa.pdf"):
    response = client.post("/jobs", files={"file": (name, content, "application/pdf")})
    assert response.status_code == 202
    return response.json()


def wait_for_end(client, job_id):
    """Poll the job like the frontend does, until it is done or failed."""
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        job = client.get(f"/jobs/{job_id}").json()
        if job["status"] in ("done", "error"):
            return job
        time.sleep(0.01)
    raise AssertionError(f"job {job_id} did not end: {job}")


def test_a_job_records_the_status_of_each_node_then_the_ui_spec(start_app, monkeypatch):
    seen = {}

    class RecordingAgent(FakeAgent):
        def play(self, inputs):
            seen["bytes"] = Path(inputs["document_path"]).read_bytes()
            seen["path"] = inputs["document_path"]
            yield from super().play(inputs)

    agent = RecordingAgent("Reading the PDF", "Building the report")
    client = start_app()
    monkeypatch.setattr(main, "agent_app", agent)

    created = submit(client)
    assert created["status"] == "queued" and created["filename"] == "coa.pdf"
    job = wait_for_end(client, created["id"])

    assert job["status"] == "done"
    assert job["statuses"] == ["Reading the PDF", "Building the report"]
    assert job["ui_spec"] == SPEC
    assert agent.calls[0] == (
        {"document_path": seen["path"]},
        {"configurable": {"thread_id": created["id"]}},
    )  # the job id is the thread id
    assert seen["bytes"] == b"%PDF-fake"
    assert not Path(seen["path"]).exists()  # the PDF is removed once the job ends


def test_the_listing_leaves_out_the_report(start_app, monkeypatch):
    client = start_app()
    monkeypatch.setattr(main, "agent_app", FakeAgent())

    first, second = submit(client, name="a.pdf"), submit(client, name="b.pdf")
    wait_for_end(client, first["id"]), wait_for_end(client, second["id"])

    jobs = client.get("/jobs").json()
    assert [job["filename"] for job in jobs] == ["a.pdf", "b.pdf"]
    assert all("ui_spec" not in job and job["status"] == "done" for job in jobs)


def test_an_agent_failure_ends_the_job_with_an_error(start_app, monkeypatch):
    class FailingAgent(FakeAgent):
        def play(self, inputs):
            yield {"status": "Reading the PDF"}
            raise RuntimeError("model unavailable")

    client = start_app()
    monkeypatch.setattr(main, "agent_app", FailingAgent())

    job = wait_for_end(client, submit(client)["id"])

    assert (job["status"], job["error"], job["statuses"]) == ("error", "model unavailable", ["Reading the PDF"])


def test_an_agent_that_ends_without_a_report_is_an_error(start_app, monkeypatch):
    client = start_app()
    monkeypatch.setattr(main, "agent_app", FakeAgent("Reading the PDF", spec=None))

    job = wait_for_end(client, submit(client)["id"])

    assert (job["status"], job["error"]) == ("error", "the agent finished without a report")


def test_at_most_the_configured_number_of_jobs_run_at_once(start_app, monkeypatch):
    lock, running, most = threading.Lock(), 0, 0

    class SlowAgent(FakeAgent):
        def play(self, inputs):
            nonlocal running, most
            with lock:
                running += 1
                most = max(most, running)
            time.sleep(0.05)
            with lock:
                running -= 1
            yield from super().play(inputs)

    client = start_app(max_runs=2)
    monkeypatch.setattr(main, "agent_app", SlowAgent())

    ids = [submit(client)["id"] for _ in range(5)]
    assert {wait_for_end(client, job_id)["status"] for job_id in ids} == {"done"}
    assert most == 2


def test_an_unknown_job_is_a_404(start_app):
    assert start_app().get("/jobs/nope").status_code == 404


def test_the_real_graph_reports_the_nodes_it_runs(start_app, fake_llm):
    fake_llm(DocumentCheck(is_coa=False, reason="It is an invoice."))
    client = start_app()

    job = wait_for_end(client, submit(client, CITRIC_ACID_PDF)["id"])

    # the extraction, plant lookup and comparison are routed around for a document that is not a CoA
    assert job["statuses"] == ["Reading the PDF", "Checking it is a CoA", "Building the report"]
    assert job["status"] == "done" and "root" in job["ui_spec"]


def interrupted_job(directory, **compile_options):
    """What a process that died leaves behind: a running job whose agent got as far as `compile_options` allows."""
    store = Jobs(directory)
    job_id = store.create("coa.pdf", io.BytesIO(CITRIC_ACID_PDF))
    store.start(job_id)
    with SqliteSaver.from_conn_string(str(directory / "checkpoints.db")) as checkpointer:
        first_run = graph.compile(checkpointer=checkpointer, **compile_options)
        first_run.invoke({"document_path": str(store.pdf_path(job_id))}, {"configurable": {"thread_id": job_id}})
    return job_id


def test_a_job_the_restart_interrupted_resumes_after_its_last_finished_node(start_app, tmp_path, fake_llm):
    llm = fake_llm(DocumentCheck(is_coa=False, reason="It is an invoice."))  # a second model call would run out of responses
    job_id = interrupted_job(tmp_path, interrupt_after=["validate_document"])  # it got through validate_document

    job = wait_for_end(start_app(), job_id)

    assert job["status"] == "done" and "root" in job["ui_spec"]
    assert job["statuses"] == ["Building the report"]  # only the node after the checkpoint ran again
    assert llm.calls == 1  # the validation of the first run was not repeated


def test_a_job_whose_run_finished_before_the_restart_is_done_without_running_again(start_app, tmp_path, fake_llm):
    llm = fake_llm(DocumentCheck(is_coa=False, reason="It is an invoice."))
    job_id = interrupted_job(tmp_path)  # the graph finished, the process died before the job was marked done

    job = wait_for_end(start_app(), job_id)

    assert job["status"] == "done" and "root" in job["ui_spec"]
    assert job["statuses"] == [] and llm.calls == 1


def test_an_interrupted_job_without_a_checkpoint_starts_over(start_app, tmp_path, fake_llm):
    fake_llm(DocumentCheck(is_coa=False, reason="It is an invoice."))
    store = Jobs(tmp_path)
    job_id = store.create("coa.pdf", io.BytesIO(CITRIC_ACID_PDF))
    store.start(job_id)
    store.add_status(job_id, "Reading the PDF")  # recorded by the process that died before its first checkpoint

    job = wait_for_end(start_app(), job_id)

    assert job["status"] == "done"
    assert job["statuses"] == ["Reading the PDF", "Checking it is a CoA", "Building the report"]  # no duplicate of the first status


def test_health_still_works_without_the_api_key(monkeypatch):
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    assert TestClient(main.app).get("/health").json() == {"status": "ok"}


@pytest.mark.parametrize(("path", "method"), [("/jobs", "POST"), ("/jobs", "GET"), ("/jobs/abc", "GET")])
def test_the_frontend_origin_is_allowed_by_cors(path, method):
    response = TestClient(main.app).options(path, headers={"Origin": "http://localhost:3000", "Access-Control-Request-Method": method})
    assert response.headers["access-control-allow-origin"] == "http://localhost:3000"
