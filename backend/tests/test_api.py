import io
import os
import threading
import time
from pathlib import Path
from types import SimpleNamespace

import psycopg
import pytest
from fastapi.testclient import TestClient

import erp
import main
import middleware
from agent.agent import DOCS_DIR
from jobs import SUMMARY, Jobs, open_checkpointer
from react_agent.react_agent import graph
from schema import schema
from schema.schema import CoAData, CoAHeader, DocumentCheck
from tests.conftest import CALL_USAGE, call, connect

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
        return SimpleNamespace(values={"ui_spec": self.spec, "result": RESULT, **USAGE} if done else {}, interrupts=())

    def stream(self, inputs, config, stream_mode):
        assert stream_mode == "custom"
        self.calls.append((inputs, config))
        yield from self.play(inputs)
        self.finished.add(config["configurable"]["thread_id"])

    def play(self, inputs):
        for text in self.statuses:
            yield {"status": text}


@pytest.fixture
def start_app(tmp_path, monkeypatch, signed_in, database):
    """Starts the app (its lifespan) with the uploads in tmp_path and the jobs in the test's database; the app is stopped after the test."""
    monkeypatch.setenv("JOBS_DIR", str(tmp_path))
    clients = []

    def start(max_runs=2):
        monkeypatch.setenv("MAX_CONCURRENT_RUNS", str(max_runs))
        client = TestClient(main.app)
        client.__enter__()
        clients.append(client)
        return client

    def stop(client):
        """Stops the app like a shutdown; start() then starts it again on the same jobs, like a restart."""
        client.__exit__(None, None, None)
        clients.remove(client)

    start.stop = stop
    yield start
    for client in clients:
        client.__exit__(None, None, None)


def upload(client, content=b"%PDF-fake", name="coa.pdf"):
    return client.post("/jobs", files={"file": (name, content, "application/pdf")})


def submit(client, content=b"%PDF-fake", name="coa.pdf"):
    response = upload(client, content, name)
    assert response.status_code == 202
    return response.json()


def wait_for_status(client, job_id, *statuses):
    """Poll the job like the frontend does, until it has one of `statuses`."""
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        job = client.get(f"/jobs/{job_id}").json()
        if job["status"] in statuses:
            return job
        time.sleep(0.01)
    raise AssertionError(f"job {job_id} is not {statuses}: {job}")


def wait_for_end(client, job_id):
    """Until the job is done or failed."""
    return wait_for_status(client, job_id, "done", "error")


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


def test_an_upload_that_is_not_a_pdf_is_refused(start_app):
    client = start_app()
    response = upload(client, b"<html>not a pdf</html>")
    assert response.status_code == 415
    assert client.get("/jobs").json() == []


def test_an_upload_over_the_size_limit_is_refused_before_it_is_read(start_app, monkeypatch):
    client = start_app()
    monkeypatch.setattr(middleware, "MAX_UPLOAD_BYTES", 1000)
    response = upload(client, b"%PDF-" + b"0" * 2000)
    assert response.status_code == 413
    assert client.get("/jobs").json() == []


def test_an_upload_without_a_content_length_is_refused(start_app):
    client = start_app()

    def chunks():  # a body of unknown length is sent chunked: nothing says how much will be spooled
        yield b"%PDF-"

    response = client.post("/jobs", content=chunks(), headers={"Content-Type": "multipart/form-data; boundary=x"})
    assert response.status_code == 411


def test_a_person_can_have_only_so_many_jobs_in_progress(start_app, monkeypatch):
    release = threading.Event()

    class BlockedAgent(FakeAgent):
        def play(self, inputs):
            release.wait(10)
            yield from super().play(inputs)

    client = start_app(max_runs=1)
    monkeypatch.setattr(main, "agent_app", BlockedAgent())
    monkeypatch.setattr(main, "MAX_ACTIVE_JOBS", 2)
    try:
        ids = [submit(client)["id"] for _ in range(2)]
        assert upload(client).status_code == 429
        assert len(client.get("/jobs").json()) == 2
    finally:
        release.set()
    assert {wait_for_end(client, job_id)["status"] for job_id in ids} == {"done"}
    submit(client)  # the finished jobs no longer count


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
    with open_checkpointer(store.dsn) as checkpointer:
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


def tables_in(schema):
    with connect() as db:
        rows = db.execute("SELECT table_name FROM information_schema.tables WHERE table_schema = %s", (schema,)).fetchall()
    return {name for (name,) in rows}


def test_the_database_has_two_tables_and_the_checkpoints_and_the_memory_have_their_own_schema(start_app, database):
    start_app()

    assert tables_in(database) == {"users", "runs", "alembic_version"}
    assert {"checkpoints", "checkpoint_writes", "langchain_pg_collection", "langchain_pg_embedding"} <= tables_in(
        os.environ["CHECKPOINT_SCHEMA"]
    )
    with connect() as db:  # pgvector is installed, for the embeddings of the answers
        assert db.execute("SELECT 1 FROM pg_extension WHERE extname = 'vector'").fetchone()


def test_a_database_made_before_the_migrations_is_adopted(tmp_path, database):
    with connect() as db:  # what the API created with plain CREATE TABLEs
        db.execute("CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT, name TEXT, created_at BIGINT NOT NULL DEFAULT 0)")
        db.execute("INSERT INTO users (id) VALUES ('user_old')")

    Jobs(tmp_path)  # applies the migrations: the tables there are left as they are, the missing ones are made

    with connect() as db:
        assert db.execute("SELECT id FROM users").fetchall() == [("user_old",)]
        assert db.execute("SELECT version_num FROM alembic_version").fetchall() == [("0001",)]
    assert tables_in(database) == {"users", "runs", "alembic_version"}


def test_starting_again_changes_nothing(tmp_path, database):
    store = Jobs(tmp_path)
    store.upsert_user("user_1")

    Jobs(tmp_path)

    with connect() as db:
        assert db.execute("SELECT id FROM users").fetchall() == [("user_1",)]


def test_a_listing_has_every_column_but_the_report_and_the_ordering(tmp_path, database):
    Jobs(tmp_path)  # SUMMARY is written out by hand: a column a migration adds has to be added to it

    with connect() as db:
        rows = db.execute("SELECT column_name FROM information_schema.columns WHERE table_schema = %s AND table_name = 'runs'", (database,))
        columns = {name for (name,) in rows}
    assert set(SUMMARY.split(", ")) == columns - {"ui_spec", "seq"}


def test_a_user_is_recorded_once_and_keeps_what_is_known_of_them(tmp_path, database):
    store = Jobs(tmp_path)

    store.upsert_user("user_1", "anna@example.com", "Anna")
    store.upsert_user("user_1")  # a later token without the claims

    with connect() as db:
        assert db.execute("SELECT id, email, name FROM users").fetchall() == [("user_1", "anna@example.com", "Anna")]


def test_a_job_needs_its_owner_to_be_a_user(tmp_path, database):
    store = Jobs(tmp_path)

    with pytest.raises(psycopg.errors.ForeignKeyViolation):
        store.create("coa.pdf", io.BytesIO(b"%PDF"), owner="nobody")


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


def test_the_frontend_may_post_json_to_the_decision_endpoint():
    headers = {"Origin": "http://localhost:3000", "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type"}
    response = TestClient(main.app).options("/jobs/abc/decision", headers=headers)
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://localhost:3000"


# a run that stops to ask a person: the check of a CoA whose one test the model flags as unsure
REASON = "The CoA reports Appearance in ppb: it could be a typo for ppm."
MATERIAL = {
    "name": "Citric Acid",
    "tests": [{"test": "Appearance", "type": "qualitative", "accepted": ["complies"], "requirement": "White"}],
}
UNTIL_THE_PAUSE = [
    call("load_document"),
    call("validate_document"),
    DocumentCheck(is_coa=True, reason="ok"),
    call("get_document_data"),
    CoAData(header=CoAHeader(product_code="CA-ANH-25", lot_number="L1"), tests=[schema.TestResult(test="Appearance", result="complies")]),
    call("load_plant_spec"),
    call("compare_specs"),
    [schema.TestCheck(test="Appearance", verdict="review", reason="Unit differs.", unsure=True, unsure_reason=REASON)],
    call("check_memory"),
    call("resolve_questions"),
]
NOTES = schema.ClarificationNotes(
    notes=[schema.ClarificationNote(test="Appearance", summary="ppb is a typo for ppm.", topic="unit_mismatch")]
)
AFTER_THE_ANSWER = [
    [schema.TestCheck(test="Appearance", verdict="pass", reason="Typo.")],
    call("remember_clarifications"),
    NOTES,
    call("write_summary"),
    call("render_ui"),
    '{"root": "a", "elements": {"a": {"type": "Text", "props": {"text": "hi"}, "children": []}}}',
    "Conforming.",
]
ANSWER = {"answers": {"Appearance": "The unit is a typo."}, "by": "QA Anna"}


@pytest.fixture
def asking(start_app, monkeypatch, fake_llm):
    """A running app and a job whose agent has stopped to ask a person; the model's remaining answers are queued."""
    monkeypatch.setattr(erp, "get_material", lambda code: MATERIAL)
    llm = fake_llm(*UNTIL_THE_PAUSE, *AFTER_THE_ANSWER)
    client = start_app(max_runs=1)
    job_id = submit(client, CITRIC_ACID_PDF)["id"]
    return client, wait_for_status(client, job_id, "needs_input"), llm


def test_a_run_that_asks_a_person_waits_with_its_question(asking):
    _, job, _ = asking
    assert job["question"]["questions"][0]["reason"] == REASON and job["question"]["id"]
    assert job["finished_at"] is None and job["ui_spec"] is None and job["answer"] is None
    assert job["statuses"][-1] == "Looking for earlier answers"


def test_a_waiting_job_does_not_hold_a_worker(asking):
    client, _, llm = asking
    llm.responses[0:0] = NOT_A_COA_RUN  # the next job's answers, before the ones the paused job is waiting for
    other = wait_for_end(client, submit(client, CITRIC_ACID_PDF)["id"])  # the only worker is free: this job runs and ends
    assert other["status"] == "done"


def test_the_answer_continues_the_run(asking):
    client, job, llm = asking
    response = client.post(f"/jobs/{job['id']}/answer", json=ANSWER)
    assert response.status_code == 200 and response.json()["status"] == "queued"
    done = wait_for_end(client, job["id"])
    assert done["status"] == "done" and done["result"]["outcome"] == "Conforming"
    assert done["question"] is None and done["answer"]["by"] == "QA Anna"
    assert done["statuses"][-4:] == ["Applying the answers", "Remembering the answers", "Summarizing the findings", "Building the report"]
    assert llm.responses == []  # every answer was used once: nothing before the question was asked again


def kept_answers():
    """What the memory holds, read from the vector store's table: (id, scope, product, the answer's summary, whether it has a vector)."""
    with connect() as db:
        return db.execute(
            "SELECT id, cmetadata->>'scope', cmetadata->>'product_code', cmetadata->>'summary', embedding IS NOT NULL "
            f"FROM {os.environ['CHECKPOINT_SCHEMA']}.langchain_pg_embedding ORDER BY id"
        ).fetchall()


def test_an_answer_is_kept_in_the_memory_with_who_it_is_for(asking):
    client, job, _ = asking
    assert client.post(f"/jobs/{job['id']}/answer", json={**ANSWER, "remember": {"Appearance": "global"}}).status_code == 200
    wait_for_end(client, job["id"])
    assert kept_answers() == [(f"{job['id']}:Appearance", "global", "CA-ANH-25", "ppb is a typo for ppm.", True)]  # with its vector


def test_an_answer_defaults_to_the_products_lots(asking):
    client, job, _ = asking
    client.post(f"/jobs/{job['id']}/answer", json=ANSWER)
    wait_for_end(client, job["id"])
    assert [(scope, product) for _, scope, product, *_ in kept_answers()] == [("product", "CA-ANH-25")]


def test_an_answer_for_this_lot_only_is_not_kept(asking):
    client, job, _ = asking
    client.post(f"/jobs/{job['id']}/answer", json={**ANSWER, "remember": {"Appearance": "none"}})
    wait_for_end(client, job["id"])
    assert kept_answers() == []


def test_a_later_run_is_asked_with_the_answer_an_earlier_one_got(asking):
    client, first, llm = asking
    client.post(f"/jobs/{first['id']}/answer", json=ANSWER)
    wait_for_end(client, first["id"])
    llm.responses.extend(UNTIL_THE_PAUSE)  # the same check, on another certificate
    second = wait_for_status(client, submit(client, CITRIC_ACID_PDF)["id"], "needs_input")
    (precedent,) = second["question"]["questions"][0]["precedents"]
    assert (precedent["answer"], precedent["by"], precedent["run_id"], precedent["match"]) == (
        ANSWER["answers"]["Appearance"],
        "QA Anna",
        first["id"],
        "same_product",
    )
    assert first["question"]["questions"][0]["precedents"] == []  # the first run had nothing to find


def test_a_test_not_asked_is_refused_in_the_scopes_too(asking):
    client, job, _ = asking
    url = f"/jobs/{job['id']}/answer"
    assert client.post(url, json={**ANSWER, "remember": {"Lead": "global"}}).status_code == 422
    assert client.post(url, json={**ANSWER, "remember": {"Appearance": "everyone"}}).status_code == 422


def test_an_answer_is_taken_once(asking):
    client, job, _ = asking
    assert client.post(f"/jobs/{job['id']}/answer", json=ANSWER).status_code == 200
    assert client.post(f"/jobs/{job['id']}/answer", json=ANSWER).status_code == 409
    wait_for_end(client, job["id"])
    assert client.post(f"/jobs/{job['id']}/answer", json=ANSWER).status_code == 409


def test_an_answer_must_be_from_someone_to_a_question_asked(asking):
    client, job, _ = asking
    url = f"/jobs/{job['id']}/answer"
    assert client.post(url, json={**ANSWER, "by": "  "}).status_code == 422
    assert client.post(url, json={"answers": {"Lead": "ppm"}, "by": "QA Anna"}).status_code == 422
    assert client.post("/jobs/nope/answer", json=ANSWER).status_code == 404
    assert client.get(f"/jobs/{job['id']}").json()["status"] == "needs_input"  # none of them used up the question


def test_a_job_that_is_not_waiting_cannot_be_answered(finished):
    client, job_id = finished
    assert client.post(f"/jobs/{job_id}/answer", json=ANSWER).status_code == 409


def test_a_waiting_job_stays_waiting_after_a_restart(asking, start_app):
    client, job, llm = asking
    start_app.stop(client)
    client = start_app()
    assert client.get(f"/jobs/{job['id']}").json()["status"] == "needs_input"  # it is not queued again, nor asked again
    assert len(llm.responses) == len(AFTER_THE_ANSWER)
    assert client.post(f"/jobs/{job['id']}/answer", json=ANSWER).status_code == 200
    assert wait_for_end(client, job["id"])["status"] == "done"


def test_a_job_answered_before_a_restart_continues_with_that_answer(asking, start_app, tmp_path):
    client, job, _ = asking
    start_app.stop(client)
    Jobs(tmp_path).answer(job["id"], {"for": job["question"]["id"], **ANSWER})  # the process died after saving the answer
    assert wait_for_end(start_app(), job["id"])["status"] == "done"


def test_an_answer_to_another_question_is_not_used(asking, start_app, tmp_path):
    client, job, _ = asking
    start_app.stop(client)
    Jobs(tmp_path).answer(job["id"], {"for": "an-earlier-question", **ANSWER})
    waiting = wait_for_status(start_app(), job["id"], "needs_input")
    assert waiting["question"]["id"] == job["question"]["id"] and waiting["answer"] is None  # asked again
