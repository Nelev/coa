import pytest

from agent import agent
from schema.schema import DocumentCheck
from tests.conftest import CALL_USAGE


def verdict(is_coa, reason="reason"):
    return DocumentCheck(is_coa=is_coa, reason=reason)


def test_a_coa_continues_to_extraction(fake_llm):
    fake_llm(verdict(True))
    out = agent.validate_document({"document_text": "Certificate of Analysis ..."})
    assert out == CALL_USAGE  # no issue, only what the call used
    assert agent.route_after_validation(out) == "get_document_data"


def test_another_document_is_rejected_with_a_not_a_coa_issue(fake_llm):
    fake_llm(verdict(False, "It is an invoice."))
    out = agent.validate_document({"document_text": "Invoice 42"})
    assert [(i["kind"], i["severity"], i["message"]) for i in out["issues"]] == [("not_a_coa", "critical", "It is an invoice.")]
    assert agent.route_after_validation(out) == "render_ui"


def test_a_pdf_without_text_is_rejected_without_calling_the_model(monkeypatch):
    monkeypatch.setattr(agent, "get_llm", lambda: pytest.fail("the model must not be called"))
    out = agent.validate_document({"document_text": "  \n"})
    assert "no extractable text" in out["issues"][0]["message"]
    assert out["cost"] == 0  # no call, no cost


def test_only_the_start_of_a_long_document_is_sent(fake_llm):
    llm = fake_llm(verdict(True))
    agent.validate_document({"document_text": "x" * (agent.VALIDATION_CHARS + 500)})
    assert llm.prompts[0].endswith("x" * agent.VALIDATION_CHARS)
    assert "x" * (agent.VALIDATION_CHARS + 1) not in llm.prompts[0]


def test_render_ui_shows_a_rejected_document_without_calling_the_model(monkeypatch):
    monkeypatch.setattr(agent, "get_llm", lambda: pytest.fail("the model must not be called"))
    issue = {"kind": "not_a_coa", "severity": "critical", "message": "It is an invoice."}
    spec = agent.render_ui({"issues": [issue]})["ui_spec"]
    alert = spec["elements"][spec["root"]]
    assert (alert["type"], alert["props"]["message"]) == ("Alert", "It is an invoice.")
