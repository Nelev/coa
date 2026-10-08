import json
from pathlib import Path

from fastapi.testclient import TestClient

import main

SPEC = {"root": "a", "elements": {"a": {"type": "Text", "props": {"text": "hi"}, "children": []}}}


def analyze_pdf():
    """POST a fake PDF to /analyze and return the streamed events."""
    response = TestClient(main.app).post("/analyze", files={"file": ("coa.pdf", b"%PDF-fake", "application/pdf")})
    assert response.status_code == 200
    return [json.loads(line) for line in response.text.splitlines()]


def test_analyze_streams_each_step_then_the_ui_spec(monkeypatch):
    seen = {}

    def fake_stream(state, stream_mode):
        assert stream_mode == "updates"
        seen["bytes"] = Path(state["document_path"]).read_bytes()
        seen["path"] = state["document_path"]
        yield {"load_document": {"document_text": "x"}}
        yield {"render_ui": {"ui_spec": SPEC}}

    monkeypatch.setattr(main.agent_app, "stream", fake_stream)

    assert analyze_pdf() == [{"step": "load_document"}, {"step": "render_ui"}, {"done": SPEC}]
    assert seen["bytes"] == b"%PDF-fake"
    assert not Path(seen["path"]).exists()  # the temp file is removed once the stream ends


def test_analyze_reports_an_agent_failure_as_an_error_line(monkeypatch):
    def fake_stream(state, stream_mode):
        yield {"load_document": {}}
        raise RuntimeError("model unavailable")

    monkeypatch.setattr(main.agent_app, "stream", fake_stream)

    assert analyze_pdf() == [{"step": "load_document"}, {"error": "model unavailable"}]


def test_health_still_works_without_the_api_key(monkeypatch):
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    assert TestClient(main.app).get("/health").json() == {"status": "ok"}


def test_the_frontend_origin_is_allowed_by_cors():
    response = TestClient(main.app).options(
        "/analyze", headers={"Origin": "http://localhost:3000", "Access-Control-Request-Method": "POST"}
    )
    assert response.headers["access-control-allow-origin"] == "http://localhost:3000"
