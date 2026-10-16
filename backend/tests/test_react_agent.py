import json
from pathlib import Path

import pytest
from langchain_core.messages import AIMessage, ToolMessage
from langgraph.checkpoint.memory import MemorySaver
from langgraph.types import Command

import erp
import notify
from react_agent.react_agent import app, graph
from react_agent.tools import tools
from schema import schema
from schema.schema import CoAData, CoAHeader, DocumentCheck
from tests.conftest import CALL_USAGE, call

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


def check_sequence(verdict, question=None):
    """The model's answers for a whole check on a CoA whose one test gets `verdict`, tools' own model calls in between."""
    check = schema.TestCheck(test="Appearance", verdict=verdict, reason="Because.", question=question)
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
        "resolve_questions",
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


# a run that a person's answer continues: the graph needs a checkpointer to pause
QUESTION = "The CoA says Appearance is 'complies (ppb)'. Is the unit right?"
COMPARED = 8  # the answers of check_sequence up to and including compare_specs' own model call
UNTIL_COMPARE = check_sequence("review", QUESTION)[:COMPARED]


def paused_run():
    """Runs a checkpointed graph (the model's answers are queued with fake_llm) until it stops: the graph, its config and the output."""
    checked = graph.compile(checkpointer=MemorySaver())
    config = {"configurable": {"thread_id": "job1"}}
    out = checked.invoke({"document_path": PDF, "filename": "lot.pdf", "job_id": "job1"}, config)
    return checked, config, out


def test_a_review_with_a_question_pauses_the_run_for_a_person(fake_llm, monkeypatch):
    monkeypatch.setattr(erp, "get_material", lambda code: MATERIAL)
    fake_llm(*UNTIL_COMPARE, call("resolve_questions"))
    checked, config, out = paused_run()
    (paused,) = out["__interrupt__"]
    assert [q["question"] for q in paused.value["questions"]] == [QUESTION]
    assert paused.value["questions"][0]["test"] == "Appearance"
    assert checked.get_state(config).next == ("tools",)
    assert "result" not in out


def test_the_answer_judges_the_test_again_and_the_run_goes_on(fake_llm, monkeypatch, mails):
    monkeypatch.setattr(erp, "get_material", lambda code: MATERIAL)
    passed = schema.TestCheck(test="Appearance", verdict="pass", reason="The unit was a typo.")
    llm = fake_llm(*UNTIL_COMPARE, call("resolve_questions"), [passed], call("write_summary"), call("render_ui"), SPEC, DONE)
    checked, config, _ = paused_run()
    out = checked.invoke(Command(resume={"answers": {"Appearance": "The unit is a typo, it is ppm."}, "by": "QA Anna"}), config)
    assert "__interrupt__" not in out
    assert out["result"]["outcome"] == "Conforming"
    assert [c["verdict"] for c in out["test_checks"]] == ["pass"]
    assert out["issues"] == [] and out["open_questions"] == []
    assert out["clarifications"] == [
        {"test": "Appearance", "question": QUESTION, "answer": "The unit is a typo, it is ppm.", "by": "QA Anna"}
    ]
    with_answer = [str(p) for p in llm.prompts if "The unit is a typo, it is ppm." in str(p)]
    assert len(with_answer) == 2  # the second judgement, and the report prompt that shows what the person answered
    assert "authoritative" in with_answer[0] and "Resolved by a person" in with_answer[1]
    assert out["input_tokens"] == CALL_USAGE["input_tokens"] * (llm.calls - 1)  # every call but DONE (it reports no usage) counted once
    assert mails == []


def test_a_question_left_unanswered_stays_a_review(fake_llm, monkeypatch):
    monkeypatch.setattr(erp, "get_material", lambda code: MATERIAL)
    fake_llm(*UNTIL_COMPARE, call("resolve_questions"), call("write_summary"), call("render_ui"), SPEC, DONE)
    checked, config, _ = paused_run()
    out = checked.invoke(Command(resume={"answers": {"Appearance": "  "}, "by": "QA Anna"}), config)
    assert out["result"]["outcome"] == "Needs review"
    assert "clarifications" not in out


def test_the_summary_waits_for_the_open_questions(fake_llm, monkeypatch):
    monkeypatch.setattr(erp, "get_material", lambda code: MATERIAL)
    fake_llm(*UNTIL_COMPARE, call("write_summary"), call("resolve_questions"))
    checked, config, _ = paused_run()
    messages = checked.get_state(config).values["messages"]
    refused = next(m for m in messages if isinstance(m, ToolMessage) and m.name == "write_summary")
    assert "call resolve_questions first" in refused.content
    assert "result" not in checked.get_state(config).values


def test_a_question_on_a_pass_is_not_asked(fake_llm, monkeypatch):
    monkeypatch.setattr(erp, "get_material", lambda code: MATERIAL)
    fake_llm(*check_sequence("pass", QUESTION)[:COMPARED], call("resolve_questions"), call("write_summary"), call("render_ui"), SPEC, DONE)
    out = run()
    assert out["open_questions"] == []
    assert ("resolve_questions", "There are no open questions.") in tool_messages(out)
