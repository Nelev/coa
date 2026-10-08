from pathlib import Path

from fastapi.testclient import TestClient

import main

SPEC = {"root": "a", "elements": {"a": {"type": "Text", "props": {"text": "hi"}, "children": []}}}


def test_analyze_runs_the_agent_on_the_uploaded_pdf_and_returns_the_ui_spec(monkeypatch):
    seen = {}

    def fake_invoke(state):
        seen["bytes"] = Path(state["document_path"]).read_bytes()
        seen["path"] = state["document_path"]
        return {"ui_spec": SPEC, "issues": ["not returned"]}

    monkeypatch.setattr(main.agent_app, "invoke", fake_invoke)
    response = TestClient(main.app).post("/analyze", files={"file": ("coa.pdf", b"%PDF-fake", "application/pdf")})

    assert response.status_code == 200
    assert response.json() == SPEC
    assert seen["bytes"] == b"%PDF-fake"
    assert not Path(seen["path"]).exists()  # the temp file is removed after the request


def test_health_still_works_without_the_api_key(monkeypatch):
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    assert TestClient(main.app).get("/health").json() == {"status": "ok"}


def test_the_frontend_origin_is_allowed_by_cors():
    response = TestClient(main.app).options(
        "/analyze", headers={"Origin": "http://localhost:3000", "Access-Control-Request-Method": "POST"}
    )
    assert response.headers["access-control-allow-origin"] == "http://localhost:3000"
