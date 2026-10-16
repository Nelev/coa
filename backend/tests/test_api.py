import io
import sqlite3
import threading
import time
from contextlib import closing
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from langgraph.checkpoint.sqlite import SqliteSaver

import main
from agent.agent import DOCS_DIR
from jobs import Jobs
from react_agent.react_agent import graph
from schema import schema
from schema.schema import DocumentCheck
from tests.conftest import CALL_USAGE, call

RESULT = {
    "outcome": "Conforming",
    "counts": {"pass": 3, "fail": 0, "review": 0},
    "product": "Citric Acid",
    "lot": "L1",
    "supplier": "Alpina",
}
USAGE = {"cost": 0.0014, "input_tokens": 140, "output_tokens": 30}  # what a run's state holds once its model calls are added up
SPEC = {"root": "a", "elements": {"a": {"type": "Text", "props": {"text": "hi"}, "children": []}}}
CITRIC_ACID_PDF = (DOCS_DIR / "sample_coa_citric_acid.pdf").read_bytes()

# the model's answers, in order, for an agent run on an invoice: three tool calls and the answer, with the check's own model call between
NOT_A_COA_RUN = [
    call("load_document"),
    call("validate_document"),
    DocumentCheck(is_coa=False, reason="It is an invoice."),
    call("render_ui"),
    "Not a CoA.",
]


class FakeAgent:
    """Stands in for the compiled graph: `stream` reports the given statuses, after which `get_state` holds the spec."""

    def __init__(self, *statuses, spec=SPEC):
        self.statuses, self.spec = statuses, spec
        self.calls = []
        self.finished = set()  # thread ids

    def get_state(self, config):
        done = config["configurable"]["thread_id"] in self.finished and self.spec is not None
        return SimpleNamespace(values={"ui_spec": self.spec, "result": RESULT, **USAGE} if done else {})

    def stream(self, inputs, config, stream_mode):
        assert stream_mode == "custom"
        self.calls.append((inputs, config))
        yield from self.play(inputs)
        self.finished.add(config["configurable"]["thread_id"])

    def play(self, inputs):
        for text in self.statuses:
            yield {"status": text}


@pytest.fixture
def start_app(tmp_path, monkeypatch, signed_in):
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
    assert job["result"] == RESULT
    assert job["started_at"] <= job["finished_at"]
    assert agent.calls[0] == (
        {"document_path": seen["path"], "filename": "coa.pdf", "job_id": created["id"]},
        {"configurable": {"thread_id": created["id"]}, "recursion_limit": main.RECURSION_LIMIT},
    )  # the job id is the thread id
    assert seen["bytes"] == b"%PDF-fake"
    assert Path(seen["path"]).read_bytes() == b"%PDF-fake"  # the certificate is kept: it is the record the decision is about


def test_a_job_records_who_uploaded_it(start_app, monkeypatch):
    client = start_app()
    monkeypatch.setattr(main, "agent_app", FakeAgent("Reading the PDF"))

    created = submit(client)

    assert created["owner"] == "user_test"  # the sign-in id the signed_in fixture acts as
    assert client.get(f"/jobs/{created['id']}").json()["owner"] == "user_test"


def test_the_certificate_can_be_opened_after_the_job_ends(start_app, monkeypatch):
    client = start_app()
    monkeypatch.setattr(main, "agent_app", FakeAgent())
    job = wait_for_end(client, submit(client, b"%PDF-1", "lot.pdf")["id"])

    assert job["has_pdf"] is True
    response = client.get(f"/jobs/{job['id']}/pdf")
    assert (response.content, response.headers["content-type"]) == (b"%PDF-1", "application/pdf")
    assert "inline" in response.headers["content-disposition"]
    assert client.get("/jobs/nope/pdf").status_code == 404


def test_the_listing_leaves_out_the_report(start_app, monkeypatch):
    client = start_app()
    monkeypatch.setattr(main, "agent_app", FakeAgent())

    first, second = submit(client, name="a.pdf"), submit(client, name="b.pdf")
    wait_for_end(client, first["id"]), wait_for_end(client, second["id"])

    jobs = client.get("/jobs").json()
    assert [job["filename"] for job in jobs] == ["a.pdf", "b.pdf"]
    assert all("ui_spec" not in job and job["status"] == "done" for job in jobs)
    assert all(job["result"] == RESULT and job["finished_at"] for job in jobs)  # what the overview shows without the report


def test_an_agent_failure_ends_the_job_with_an_error(start_app, monkeypatch):
    class FailingAgent(FakeAgent):
        def play(self, inputs):
            yield {"status": "Reading the PDF"}
            raise RuntimeError("model unavailable")

    client = start_app()
    monkeypatch.setattr(main, "agent_app", FailingAgent())

    job = wait_for_end(client, submit(client)["id"])

    assert (job["status"], job["error"], job["statuses"]) == ("error", "model unavailable", ["Reading the PDF"])
    assert job["finished_at"] and job["result"] is None


def usage_of(job):
    return job["input_tokens"], job["output_tokens"], job["cost_usd"]


def test_a_finished_job_lists_what_its_model_calls_used(start_app, monkeypatch):
    client = start_app()
    monkeypatch.setattr(main, "agent_app", FakeAgent("Reading the PDF"))

    job = wait_for_end(client, submit(client)["id"])

    assert usage_of(job) == (140, 30, 0.0014)
    assert usage_of(next(listed for listed in client.get("/jobs").json() if listed["id"] == job["id"])) == (140, 30, 0.0014)


def test_a_failed_job_keeps_what_the_calls_before_the_failure_used(start_app, monkeypatch):
    class FailingAfterCalls(FakeAgent):
        def get_state(self, config):
            return SimpleNamespace(values=USAGE)

        def play(self, inputs):
            raise RuntimeError("model unavailable")
            yield

    client = start_app()
    monkeypatch.setattr(main, "agent_app", FailingAfterCalls())

    job = wait_for_end(client, submit(client)["id"])

    assert job["status"] == "error" and usage_of(job) == (140, 30, 0.0014)


def test_a_job_that_failed_before_any_call_has_no_usage(start_app, monkeypatch):
    class FailingEarly(FakeAgent):
        def play(self, inputs):
            raise RuntimeError("cannot read the PDF")
            yield

    client = start_app()
    monkeypatch.setattr(main, "agent_app", FailingEarly())

    job = wait_for_end(client, submit(client)["id"])

    assert job["status"] == "error" and usage_of(job) == (None, None, None)


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


def test_the_real_graph_reports_the_steps_it_runs(start_app, fake_llm):
    fake_llm(*NOT_A_COA_RUN)
    client = start_app()

    job = wait_for_end(client, submit(client, CITRIC_ACID_PDF)["id"])

    # the extraction, plant lookup and comparison are skipped for a document that is not a CoA
    assert job["statuses"] == ["Reading the PDF", "Checking it is a CoA", "Building the report"]
    assert job["status"] == "done" and "root" in job["ui_spec"]
    assert job["result"] == {
        "outcome": "Not a CoA",
        "counts": {"pass": 0, "fail": 0, "review": 0},
        "product": None,
        "lot": None,
        "supplier": None,
    }


def test_the_state_adds_up_what_each_model_call_used(fake_llm):
    fake_llm(
        call("load_document"),
        call("validate_document"),
        DocumentCheck(is_coa=True, reason="ok"),
        call("get_document_data"),
        schema.CoAData(header=schema.CoAHeader(product_code="XX-1"), tests=[]),  # no plant spec for this code: the comparison is skipped
        call("load_plant_spec"),
        call("write_summary"),
        call("render_ui"),
        '{"root": "a", "elements": {"a": {"type": "Text", "props": {"text": "hi"}, "children": []}}}',
        "Non-conforming.",
    )
    values = graph.compile().invoke({"document_path": str(DOCS_DIR / "sample_coa_citric_acid.pdf")})
    calls = 10  # the model's 7 answers (6 tool calls and the last answer), the validation, the extraction and the report
    assert values["cost"] == pytest.approx(calls * CALL_USAGE["cost"])
    assert (values["input_tokens"], values["output_tokens"]) == (calls * CALL_USAGE["input_tokens"], calls * CALL_USAGE["output_tokens"])


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
    llm = fake_llm(*NOT_A_COA_RUN)
    job_id = interrupted_job(tmp_path, interrupt_after=["tools"])  # it got through the first tools node, load_document

    job = wait_for_end(start_app(), job_id)

    assert job["status"] == "done" and "root" in job["ui_spec"]
    assert job["statuses"] == ["Checking it is a CoA", "Building the report"]  # only what came after the checkpoint ran again
    assert llm.responses == []  # every answer was used once: nothing of the first run was asked again


def test_a_job_whose_run_finished_before_the_restart_is_done_without_running_again(start_app, tmp_path, fake_llm):
    llm = fake_llm(*NOT_A_COA_RUN)
    job_id = interrupted_job(tmp_path)  # the graph finished, the process died before the job was marked done

    job = wait_for_end(start_app(), job_id)

    assert job["status"] == "done" and "root" in job["ui_spec"]
    assert job["statuses"] == [] and llm.responses == []


def test_an_interrupted_job_without_a_checkpoint_starts_over(start_app, tmp_path, fake_llm):
    fake_llm(*NOT_A_COA_RUN)
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


def legacy_jobs_db(directory, extra_columns=""):
    """A jobs.db from before the columns in jobs.ADDED_COLUMNS (or some of them, in `extra_columns`), with one finished job, 'old'."""
    with closing(sqlite3.connect(directory / "jobs.db")) as db, db:
        columns = "id TEXT PRIMARY KEY, filename TEXT NOT NULL, status TEXT NOT NULL, statuses TEXT NOT NULL DEFAULT '[]'"
        db.execute(f"CREATE TABLE jobs ({columns}, ui_spec TEXT, error TEXT, started_at INTEGER{extra_columns})")
        db.execute("INSERT INTO jobs (id, filename, status) VALUES ('old', 'old.pdf', 'done')")


def test_a_database_from_before_the_result_columns_is_upgraded(tmp_path):
    legacy_jobs_db(tmp_path)

    job = Jobs(tmp_path).get("old")

    assert job["filename"] == "old.pdf" and job["result"] is None and job["finished_at"] is None


def decide(client, job_id, decision="approved", by="QA Anna", reason=""):
    return client.post(f"/jobs/{job_id}/decision", json={"decision": decision, "by": by, "reason": reason})


@pytest.fixture
def finished(start_app, monkeypatch):
    """A finished job (outcome Conforming) in a running app."""
    client = start_app()
    monkeypatch.setattr(main, "agent_app", FakeAgent())
    return client, wait_for_end(client, submit(client)["id"])["id"]


def test_a_new_job_has_no_decision(finished):
    client, job_id = finished
    job = client.get(f"/jobs/{job_id}").json()
    assert [job[k] for k in ("decision", "decided_by", "decided_at", "reason")] == [None] * 4


def test_a_conforming_lot_can_be_approved_without_a_reason(finished):
    client, job_id = finished
    response = decide(client, job_id, by=" QA Anna ")
    assert response.status_code == 200
    body = response.json()
    assert (body["decision"], body["decided_by"], body["reason"]) == ("approved", "QA Anna", "")
    assert body["decided_at"] and "ui_spec" not in body
    assert client.get(f"/jobs/{job_id}").json()["decision"] == "approved"  # and it is in the listing too
    assert client.get("/jobs").json()[0]["decision"] == "approved"


@pytest.mark.parametrize("decision", ["rejected", "on_hold"])
def test_rejecting_or_holding_needs_a_reason(finished, decision):
    client, job_id = finished
    assert decide(client, job_id, decision, reason="  ").status_code == 422
    assert decide(client, job_id, decision, reason="Water above the limit").status_code == 200


def test_approving_a_lot_that_does_not_conform_is_an_override_that_needs_a_reason(start_app, monkeypatch):
    client = start_app()
    monkeypatch.setattr(main, "agent_app", FakeAgent())
    monkeypatch.setitem(RESULT, "outcome", "Needs review")
    job_id = wait_for_end(client, submit(client)["id"])["id"]

    assert decide(client, job_id).status_code == 422
    assert decide(client, job_id, reason="Lab retest 0.31 %, within the limit").status_code == 200


def test_who_decides_is_required(finished):
    client, job_id = finished
    assert decide(client, job_id, by="  ").status_code == 422
    assert decide(client, job_id, decision="maybe").status_code == 422


def test_approved_and_rejected_are_final(finished):
    client, job_id = finished
    assert decide(client, job_id, "rejected", reason="Wrong lot").status_code == 200
    again = decide(client, job_id, "approved")
    assert again.status_code == 409
    assert client.get(f"/jobs/{job_id}").json()["decision"] == "rejected"


def test_a_lot_on_hold_can_be_decided_later(finished):
    client, job_id = finished
    assert decide(client, job_id, "on_hold", reason="Waiting for the supplier").status_code == 200
    assert decide(client, job_id, "approved", by="QA Marco").json()["decided_by"] == "QA Marco"


def test_only_a_finished_job_can_be_decided(start_app, monkeypatch):
    release = threading.Event()

    class WaitingAgent(FakeAgent):
        def play(self, inputs):
            release.wait(5)
            yield from super().play(inputs)

    client = start_app()
    monkeypatch.setattr(main, "agent_app", WaitingAgent())
    job_id = submit(client)["id"]
    try:
        assert decide(client, job_id, "rejected", reason="r").status_code == 409
    finally:
        release.set()
    assert decide(client, "nope", "rejected", reason="r").status_code == 404


def test_a_database_from_before_the_decision_columns_is_upgraded(tmp_path):
    legacy_jobs_db(tmp_path, ", result TEXT, finished_at INTEGER")

    store = Jobs(tmp_path)

    assert store.get("old")["decision"] is None and store.get("old")["has_pdf"] is False
    assert store.decide("old", "approved", "QA Anna", "") is True


def test_the_frontend_may_post_json_to_the_decision_endpoint():
    headers = {"Origin": "http://localhost:3000", "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type"}
    response = TestClient(main.app).options("/jobs/abc/decision", headers=headers)
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://localhost:3000"
