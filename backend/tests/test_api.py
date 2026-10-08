import json
from pathlib import Path

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


def test_analyze_streams_the_status_of_each_node_then_the_ui_spec(monkeypatch):
    seen = {}

    def fake_stream(state, stream_mode, version):
        assert (stream_mode, version) == (["updates", "custom"], "v2")
        seen["bytes"] = Path(state["document_path"]).read_bytes()
        seen["path"] = state["document_path"]
        yield {"type": "custom", "ns": (), "data": {"status": "Reading the PDF"}}
        yield {"type": "updates", "ns": (), "data": {"load_document": {"document_text": "x"}}}
        yield {"type": "updates", "ns": (), "data": {"validate_document": None}}  # a node with nothing to update
        yield {"type": "custom", "ns": (), "data": {"status": "Building the report"}}
        yield {"type": "updates", "ns": (), "data": {"render_ui": {"ui_spec": SPEC}}}

    monkeypatch.setattr(main.agent_app, "stream", fake_stream)

    assert analyze_pdf() == [{"status": "Reading the PDF"}, {"status": "Building the report"}, {"done": SPEC}]
    assert seen["bytes"] == b"%PDF-fake"
    assert not Path(seen["path"]).exists()  # the temp file is removed once the stream ends


def test_analyze_reports_an_agent_failure_as_an_error_line(monkeypatch):
    def fake_stream(state, stream_mode, version):
        yield {"type": "custom", "ns": (), "data": {"status": "Reading the PDF"}}
        raise RuntimeError("model unavailable")

    monkeypatch.setattr(main.agent_app, "stream", fake_stream)

    assert analyze_pdf() == [{"status": "Reading the PDF"}, {"error": "model unavailable"}]


def test_the_real_graph_reports_the_nodes_it_runs(fake_llm):
    fake_llm(DocumentCheck(is_coa=False, reason="It is an invoice."))
    events = analyze_pdf((DOCS_DIR / "sample_coa_citric_acid.pdf").read_bytes())

    # the extraction, plant lookup and comparison are routed around for a document that is not a CoA
    assert events[:-1] == [{"status": "Reading the PDF"}, {"status": "Checking it is a CoA"}, {"status": "Building the report"}]
    assert "done" in events[-1]


def test_health_still_works_without_the_api_key(monkeypatch):
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    assert TestClient(main.app).get("/health").json() == {"status": "ok"}


def test_the_frontend_origin_is_allowed_by_cors():
    response = TestClient(main.app).options(
        "/analyze", headers={"Origin": "http://localhost:3000", "Access-Control-Request-Method": "POST"}
    )
    assert response.headers["access-control-allow-origin"] == "http://localhost:3000"
