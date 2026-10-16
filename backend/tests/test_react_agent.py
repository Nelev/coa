import json
from pathlib import Path

import pytest
from langchain_core.messages import AIMessage, ToolMessage

import erp
import notify
from react_agent.react_agent import app
from react_agent.tools import tools
from schema import schema
from schema.schema import CoAData, CoAHeader, DocumentCheck
from tests.conftest import call

PDF = str(Path(__file__).resolve().parent.parent / "docs" / "sample_coa_citric_acid.pdf")
SPEC = json.dumps({"root": "a", "elements": {"a": {"type": "Alert", "props": {}, "children": []}}})
APPEARANCE = {"test": "Appearance", "type": "qualitative", "accepted": ["complies"], "requirement": "White powder"}
MATERIAL = {"name": "Citric Acid", "tests": [APPEARANCE]}
RESULT = schema.TestResult(test="Appearance", result="complies")
IS_COA = DocumentCheck(is_coa=True, reason="a CoA")
DONE = AIMessage("Conforming.")


def run():
    return app.invoke({"document_path": PDF, "filename": "lot.pdf", "job_id": "job1"})


def tool_messages(out):
    return [(m.name, m.content) for m in out["messages"] if isinstance(m, ToolMessage)]


def check_sequence(verdict):
    """The model's answers for a whole check on a CoA whose one test gets `verdict`, tools' own model calls in between."""
    check = schema.TestCheck(test="Appearance", verdict=verdict, reason="Because.")
    return [
        call("load_document"),
        call("validate_document"),
        IS_COA,
        call("get_document_data"),
        CoAData(header=CoAHeader(product_code="CA-ANH-25", lot_number="L1"), tests=[RESULT]),
        call("load_plant_spec"),
        call("compare_specs"),
        [check],
        call("write_summary"),
        call("render_ui"),
        SPEC,
    ]


def test_the_agent_has_two_nodes():
    assert set(app.get_graph().nodes) - {"__start__", "__end__"} == {"agent", "tools"}


def test_a_conforming_certificate_is_checked_and_not_mailed(fake_llm, monkeypatch, mails):
    monkeypatch.setattr(erp, "get_material", lambda code: MATERIAL)
    fake_llm(*check_sequence("pass"), DONE)
    out = run()
    assert [name for name, _ in tool_messages(out)] == [
        "load_document",
        "validate_document",
        "get_document_data",
        "load_plant_spec",
        "compare_specs",
        "write_summary",
        "render_ui",
    ]
    assert out["result"]["outcome"] == "Conforming"
    assert out["ui_spec"]["root"] == "a"
    assert out["messages"][-1].content == "Conforming."
    assert out["plant_spec"] == MATERIAL
    assert out["document_text"] not in "".join(
        content for _, content in tool_messages(out)
    )  # the text is in the state, not the conversation
    assert out["input_tokens"] > 0  # the model calls' usage is added up
    assert mails == []


def test_a_non_conforming_certificate_is_mailed_by_notify_quality_team(fake_llm, monkeypatch, mails):
    monkeypatch.setattr(erp, "get_material", lambda code: MATERIAL)
    monkeypatch.setenv("APP_URL", "http://localhost:3000")
    fake_llm(*check_sequence("fail"), call("notify_quality_team"), DONE)
    out = run()
    assert out["result"]["outcome"] == "Non-conforming"
    assert tool_messages(out)[-1] == ("notify_quality_team", "sent")
    assert [(subject, "Open the job: http://localhost:3000/runs/job1" in body) for subject, body in mails] == [
        ("Non-conforming CoA: L1", True)
    ]


def test_the_mail_is_refused_for_a_lot_that_is_not_non_conforming(fake_llm, monkeypatch, mails):
    monkeypatch.setattr(erp, "get_material", lambda code: MATERIAL)
    fake_llm(*check_sequence("pass"), call("notify_quality_team"), DONE)  # what the live model did on every conforming run
    out = run()
    assert "Nothing sent" in tool_messages(out)[-1][1]
    assert mails == []


def test_a_mail_that_cannot_be_sent_leaves_the_run_done_and_logs_a_warning(fake_llm, monkeypatch, caplog):
    monkeypatch.setattr(erp, "get_material", lambda code: MATERIAL)

    def broken(subject, body):
        raise OSError("mail server down")

    monkeypatch.setattr(notify, "send_mail", broken)
    fake_llm(*check_sequence("fail"), call("notify_quality_team"), DONE)
    out = run()
    assert tool_messages(out)[-1] == ("notify_quality_team", "not sent: OSError: mail server down")
    assert out["ui_spec"] is not None
    assert [r.levelname for r in caplog.records if r.name == "react_agent.tools"] == ["WARNING"]


def test_a_document_that_is_not_a_coa_goes_straight_to_the_report(fake_llm, mails):
    fake_llm(call("load_document"), call("validate_document"), DocumentCheck(is_coa=False, reason="An invoice."), call("render_ui"), DONE)
    out = run()
    assert [name for name, _ in tool_messages(out)] == ["load_document", "validate_document", "render_ui"]
    assert out["result"]["outcome"] == "Not a CoA"
    assert mails == []


def test_a_tool_called_too_early_is_told_to_the_model_and_the_run_goes_on(fake_llm):
    fake_llm(call("validate_document"), call("load_document"), DONE)
    out = run()
    first = tool_messages(out)[0]
    assert first[0] == "validate_document" and "call load_document first" in first[1]
    assert tool_messages(out)[1][0] == "load_document"


def test_an_erp_failure_fails_the_run(fake_llm, monkeypatch):
    def down(_code):
        raise ConnectionError("ERP unreachable")

    monkeypatch.setattr(erp, "get_material", down)
    fake_llm(*check_sequence("pass")[:6], call("load_plant_spec"))
    with pytest.raises(ConnectionError):
        run()


def test_the_tools_take_no_arguments_from_the_model():
    assert [t.name for t in tools] == [
        "load_document",
        "validate_document",
        "get_document_data",
        "load_plant_spec",
        "compare_specs",
        "write_summary",
        "render_ui",
        "notify_quality_team",
    ]
    assert all(t.args == {} and t.description for t in tools)


def test_an_unknown_product_code_is_a_missing_plant_spec(fake_llm, monkeypatch, mails):
    monkeypatch.setattr(erp, "get_material", lambda code: None)
    fake_llm(*check_sequence("pass")[:6], call("write_summary"), call("render_ui"), SPEC, call("notify_quality_team"), DONE)
    out = run()
    assert [(i["kind"], i["severity"]) for i in out["issues"]] == [("missing_plant_spec", "critical")]
    assert "CA-ANH-25" in out["issues"][0]["message"]
    assert out["result"]["outcome"] == "Non-conforming"
    assert len(mails) == 1


def test_a_certificate_without_a_product_code_does_not_query_the_erp(fake_llm, monkeypatch):
    monkeypatch.setattr(erp, "get_material", lambda code: pytest.fail("the ERP must not be queried"))
    fake_llm(
        call("load_document"),
        call("validate_document"),
        IS_COA,
        call("get_document_data"),
        CoAData(header=CoAHeader(), tests=[RESULT]),
        call("load_plant_spec"),
        DONE,
    )
    assert run()["issues"][0]["kind"] == "missing_plant_spec"
