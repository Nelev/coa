import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import main
from agent.agent import DOCS_DIR
from schema.schema import DocumentCheck

SPEC = {"root": "a", "elements": {"a": {"type": "Text", "props": {"text": "hi"}, "children": []}}}


def analyze_pdf(content=b"%PDF-fake"):
    """POST a PDF (a fake one by default) to /analyze and return the streamed events."""
    response = TestClient(main.app).post("/analyze", files={"file": ("coa.pdf", content, "application/pdf")})
    assert response.status_code == 200
    return [json.loads(line) for line in response.text.splitlines()]


def start(node):
    return "tasks", {"id": f"id-{node}", "name": node, "input": {}, "triggers": []}


def result(node, output=None, error=None):
    return "tasks", {"id": f"id-{node}", "name": node, "error": error, "result": output, "interrupts": []}


def output(text):
    return "custom", text


def test_analyze_streams_start_output_and_finish_of_each_step_then_the_ui_spec(monkeypatch):
    seen = {}

    def fake_stream(state, stream_mode):
        assert stream_mode == ["tasks", "custom"]
        seen["bytes"] = Path(state["document_path"]).read_bytes()
        seen["path"] = state["document_path"]
        yield start("load_document")
        yield output("1,234 characters read")
        yield result("load_document", {"document_text": "x"})
        yield start("render_ui")
        yield result("render_ui", {"ui_spec": SPEC})

    monkeypatch.setattr(main.agent_app, "stream", fake_stream)

    events = analyze_pdf()
    assert [list(e) for e in events] == [["start"], ["output", "node"], ["step", "ms"], ["start"], ["step", "ms"], ["done"]]
    assert events[1] == {"output": "1,234 characters read", "node": "load_document"}
    assert [e["step"] for e in events if "step" in e] == ["load_document", "render_ui"]
    assert events[-1] == {"done": SPEC}
    assert seen["bytes"] == b"%PDF-fake"
    assert not Path(seen["path"]).exists()  # the temp file is removed once the stream ends


def test_analyze_times_a_step_from_its_start_to_its_result(monkeypatch):
    clock = iter([10.0, 12.5])  # perf_counter at the start and at the result
    monkeypatch.setattr(main, "perf_counter", lambda: next(clock))
    monkeypatch.setattr(main.agent_app, "stream", lambda state, stream_mode: iter([start("compare_specs"), result("compare_specs", {})]))

    assert analyze_pdf()[1] == {"step": "compare_specs", "ms": 2500}


def test_analyze_stops_at_the_first_failed_step(monkeypatch):
    def fake_stream(state, stream_mode):
        yield start("get_document_data")
        yield result("get_document_data", None, error="model unavailable")
        pytest.fail("the stream must stop at the first failed step")

    monkeypatch.setattr(main.agent_app, "stream", fake_stream)

    assert analyze_pdf() == [{"start": "get_document_data"}, {"error": "model unavailable"}]


def test_analyze_reports_an_agent_failure_as_an_error_line(monkeypatch):
    def fake_stream(state, stream_mode):
        yield start("load_document")
        raise RuntimeError("model unavailable")

    monkeypatch.setattr(main.agent_app, "stream", fake_stream)

    assert analyze_pdf() == [{"start": "load_document"}, {"error": "model unavailable"}]


def test_the_real_graph_reports_what_each_step_it_runs_produced(fake_llm):
    fake_llm(DocumentCheck(is_coa=False, reason="It is an invoice."))
    events = analyze_pdf((DOCS_DIR / "sample_coa_citric_acid.pdf").read_bytes())

    # the extraction, plant lookup and comparison are routed around for a document that is not a CoA
    assert [e["start"] for e in events if "start" in e] == ["load_document", "validate_document", "render_ui"]
    outputs = {e["node"]: e["output"] for e in events if "output" in e}
    assert outputs["load_document"].endswith("characters read")
    assert outputs["validate_document"] == "It is an invoice."
    assert "done" in events[-1]


def test_health_still_works_without_the_api_key(monkeypatch):
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    assert TestClient(main.app).get("/health").json() == {"status": "ok"}


def test_the_frontend_origin_is_allowed_by_cors():
    response = TestClient(main.app).options(
        "/analyze", headers={"Origin": "http://localhost:3000", "Access-Control-Request-Method": "POST"}
    )
    assert response.headers["access-control-allow-origin"] == "http://localhost:3000"
