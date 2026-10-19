import json
from pathlib import Path
from unittest.mock import Mock

import pytest
from langchain_core.messages import AIMessage, ToolMessage
from langgraph.checkpoint.memory import MemorySaver
from langgraph.types import Command

import erp
import memory
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


def check_sequence(verdict, **flags):
    """The model's answers for a whole check on a CoA whose one test gets `verdict`, tools' own model calls in between."""
    check = schema.TestCheck(test="Appearance", verdict=verdict, reason="Because.", **flags)
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
        "check_memory",
        "resolve_questions",
        "remember_clarifications",
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


# a check the model flagged as unsure pauses the run for a person; the graph needs a checkpointer to pause
REASON = "The unit is ppb, the plant expects ppm: it could be a typo."
COMPARED = 8  # the answers of check_sequence up to and including compare_specs' own model call
ASK = [call("check_memory"), call("resolve_questions")]  # the tools that look for earlier answers and then ask a person
UNTIL_COMPARE = check_sequence("review", unsure=True, unsure_reason=REASON)[:COMPARED]


def paused_run():
    """Runs a checkpointed graph (the model's answers are queued with fake_llm) until it stops: the graph, its config and the output.

    The tests that use it have the `database` fixture: the memory's vector store is in it."""
    checked = graph.compile(checkpointer=MemorySaver())
    config = {"configurable": {"thread_id": "job1"}}
    out = checked.invoke({"document_path": PDF, "filename": "lot.pdf", "job_id": "job1"}, config)
    return checked, config, out


@pytest.mark.parametrize("verdict", ["review", "pass"])  # a flag sends the check to a person whatever its verdict
def test_a_check_flagged_unsure_pauses_the_run_for_a_person(database, fake_llm, monkeypatch, verdict):
    monkeypatch.setattr(erp, "get_material", lambda code: MATERIAL)
    fake_llm(*check_sequence(verdict, unsure=True, unsure_reason=REASON)[:COMPARED], *ASK)
    checked, config, out = paused_run()
    (paused,) = out["__interrupt__"]
    assert [q["reason"] for q in paused.value["questions"]] == [REASON]
    assert paused.value["questions"][0]["test"] == "Appearance"
    assert checked.get_state(config).next == ("tools",)
    assert "result" not in out


ANSWER = "The unit is a typo, it is ppm."
RULE = "A unit written ppb on this test is a typo for ppm."
NOTES = schema.ClarificationNotes(notes=[schema.ClarificationNote(test="Appearance", summary=RULE, topic="unit_mismatch")])
PASSED = schema.TestCheck(test="Appearance", verdict="pass", reason="The unit was a typo.")
AFTER_ANSWER = [*ASK, [PASSED]]  # the tool that asks, and the second judgement of the answered test
REMEMBER = [call("remember_clarifications"), NOTES]
FINISH = [call("write_summary"), call("render_ui"), SPEC, DONE]


def answered_run(remember=None):
    """Runs the check until it asks a person, then answers it (the model's answers are queued with fake_llm); `remember`: who it is for."""
    reply = {"answers": {"Appearance": ANSWER}, "by": "QA Anna", "remember": remember or {}}
    checked, config, _ = paused_run()
    return checked.invoke(Command(resume=reply), config)


def test_the_answer_judges_the_test_again_and_the_run_goes_on(database, fake_llm, monkeypatch, mails):
    monkeypatch.setattr(erp, "get_material", lambda code: MATERIAL)
    llm = fake_llm(*UNTIL_COMPARE, *AFTER_ANSWER, *REMEMBER, *FINISH)
    out = answered_run()
    assert "__interrupt__" not in out
    assert out["result"]["outcome"] == "Conforming"
    assert [c["verdict"] for c in out["test_checks"]] == ["pass"]
    assert out["issues"] == [] and out["open_questions"] == []
    assert out["clarifications"] == [
        {
            "test": "Appearance",
            "reason": REASON,
            "answer": ANSWER,
            "by": "QA Anna",
            "scope": "product",
            "summary": RULE,
            "topic": "unit_mismatch",
        }
    ]
    with_answer = [str(p) for p in llm.prompts if ANSWER in str(p)]
    assert len(with_answer) == 3  # the second judgement, the summary of the answer, and the report prompt that shows what was answered
    assert "authoritative" in with_answer[0] and "Answers (JSON)" in with_answer[1] and "Resolved by a person" in with_answer[2]
    assert RULE in with_answer[2] and "unit_mismatch" in with_answer[2]  # the report shows what was kept
    assert out["input_tokens"] == CALL_USAGE["input_tokens"] * (llm.calls - 1)  # every call but DONE (it reports no usage) counted once
    assert mails == []


def test_a_flagged_check_left_unanswered_keeps_its_verdict(database, fake_llm, monkeypatch):
    monkeypatch.setattr(erp, "get_material", lambda code: MATERIAL)
    fake_llm(*UNTIL_COMPARE, *ASK, call("write_summary"), call("render_ui"), SPEC, DONE)
    checked, config, _ = paused_run()
    out = checked.invoke(Command(resume={"answers": {"Appearance": "  "}, "by": "QA Anna"}), config)
    assert out["result"]["outcome"] == "Needs review"
    assert "clarifications" not in out


def test_the_summary_waits_for_the_flagged_checks(database, fake_llm, monkeypatch):
    monkeypatch.setattr(erp, "get_material", lambda code: MATERIAL)
    fake_llm(*UNTIL_COMPARE, call("write_summary"), *ASK)
    checked, config, _ = paused_run()
    messages = checked.get_state(config).values["messages"]
    refused = next(m for m in messages if isinstance(m, ToolMessage) and m.name == "write_summary")
    assert "call resolve_questions first" in refused.content
    assert "result" not in checked.get_state(config).values


def test_a_review_that_is_not_flagged_does_not_pause_the_run(fake_llm, monkeypatch):
    monkeypatch.setattr(erp, "get_material", lambda code: MATERIAL)
    fake_llm(*check_sequence("review")[:COMPARED], call("resolve_questions"), call("write_summary"), call("render_ui"), SPEC, DONE)
    out = run()
    assert out["open_questions"] == [] and out["result"]["outcome"] == "Needs review"
    assert ("resolve_questions", "No check is flagged as unsure.") in tool_messages(out)


def test_a_flag_without_a_reason_asks_with_the_reason_of_the_check(database, fake_llm, monkeypatch):
    monkeypatch.setattr(erp, "get_material", lambda code: MATERIAL)
    fake_llm(*check_sequence("pass", unsure=True)[:COMPARED], *ASK)
    _, _, out = paused_run()
    assert out["__interrupt__"][0].value["questions"][0]["reason"] == "Because."


def kept():
    """The documents in the memory: their metadata, with `text`, what is embedded."""
    docs = memory.vector_store().similarity_search("anything", k=50)
    return [{**d.metadata, "text": d.page_content} for d in docs]


def earlier_answer(*, run="old", scope="product", answer="It is ppm."):
    """An answer kept by an earlier run (`run`), by QA Marco, about the same situation as REASON."""
    clarification = {"test": "Appearance", "reason": REASON, "answer": answer, "by": "QA Marco", "scope": scope}
    note = schema.ClarificationNote(test="Appearance", summary=RULE, topic="unit_mismatch")
    memory.keep([clarification], {"product_code": "CA-ANH-25"}, run, {"Appearance": note})


def asked():
    """The questions a run is paused on, with what check_memory found for them."""
    return paused_run()[2]["__interrupt__"][0].value["questions"]


def test_a_kept_answer_is_stored_with_its_summary_and_topic_for_the_product(database, fake_llm, monkeypatch):
    monkeypatch.setattr(erp, "get_material", lambda code: MATERIAL)
    fake_llm(*UNTIL_COMPARE, *AFTER_ANSWER, *REMEMBER, *FINISH)
    out = answered_run()
    (value,) = kept()
    assert {k: v for k, v in value.items() if k not in ("text", "answered_at")} == {
        "test": "Appearance",
        "reason": REASON,
        "answer": ANSWER,
        "summary": RULE,
        "topic": "unit_mismatch",
        "scope": "product",
        "product_code": "CA-ANH-25",
        "lot": "L1",
        "run_id": "job1",
        "answered_by": "QA Anna",
    }
    assert RULE in value["text"] and ANSWER in value["text"]  # what is embedded
    assert out["memory_saved"] is True
    assert ("remember_clarifications", "Kept 1 answer(s).") in tool_messages(out)


def test_an_answer_for_every_product_is_stored_with_the_global_scope(database, fake_llm, monkeypatch):
    monkeypatch.setattr(erp, "get_material", lambda code: MATERIAL)
    fake_llm(*UNTIL_COMPARE, *AFTER_ANSWER, *REMEMBER, *FINISH)
    answered_run(remember={"Appearance": "global"})
    assert [v["scope"] for v in kept()] == ["global"]


def test_an_answer_for_this_lot_only_is_not_kept(database, fake_llm, monkeypatch):
    monkeypatch.setattr(erp, "get_material", lambda code: MATERIAL)
    llm = fake_llm(*UNTIL_COMPARE, *AFTER_ANSWER, call("remember_clarifications"), *FINISH)
    out = answered_run(remember={"Appearance": "none"})
    assert kept() == [] and out["memory_saved"] is True
    assert llm.responses == []  # no model call was made to summarize it
    assert [c["scope"] for c in out["clarifications"]] == ["none"] and "summary" not in out["clarifications"][0]


def test_the_summary_waits_for_the_answers_to_be_kept(database, fake_llm, monkeypatch):
    monkeypatch.setattr(erp, "get_material", lambda code: MATERIAL)
    fake_llm(*UNTIL_COMPARE, *AFTER_ANSWER, call("write_summary"), *REMEMBER, *FINISH)
    out = answered_run()
    refused = next(m for m in out["messages"] if isinstance(m, ToolMessage) and m.name == "write_summary" and "remember" in m.content)
    assert "call remember_clarifications first" in refused.content
    assert out["result"]["outcome"] == "Conforming"


def test_the_answers_are_not_kept_before_a_person_has_answered(database, fake_llm, monkeypatch):
    monkeypatch.setattr(erp, "get_material", lambda code: MATERIAL)
    fake_llm(*UNTIL_COMPARE, call("remember_clarifications"), *ASK)
    checked, config, _ = paused_run()
    refused = next(m for m in checked.get_state(config).values["messages"] if m.type == "tool" and m.name == "remember_clarifications")
    assert "call resolve_questions first" in refused.content
    assert "memory_saved" not in checked.get_state(config).values and kept() == []


def test_a_model_that_fails_to_summarize_does_not_stop_the_run(database, fake_llm, monkeypatch, caplog):
    monkeypatch.setattr(erp, "get_material", lambda code: MATERIAL)
    fake_llm(*UNTIL_COMPARE, *AFTER_ANSWER, call("remember_clarifications"), ValueError("bad reply"), *FINISH)
    out = answered_run()
    (value,) = kept()
    assert value["summary"] is None and value["topic"] is None and value["answer"] == ANSWER  # still kept, and searchable by its text
    assert out["result"]["outcome"] == "Conforming" and "summary" not in out["clarifications"][0]
    assert "were not summarized" in caplog.text


def test_a_memory_that_cannot_be_reached_does_not_stop_the_run(fake_llm, monkeypatch, caplog):
    monkeypatch.setattr(erp, "get_material", lambda code: MATERIAL)
    monkeypatch.setattr(memory, "vector_store", Mock(side_effect=ConnectionError("down")))
    fake_llm(*UNTIL_COMPARE, *AFTER_ANSWER, *REMEMBER, *FINISH)
    out = answered_run()
    assert out["result"]["outcome"] == "Conforming" and out["memory_saved"] is True
    assert any(
        name == "remember_clarifications" and content.startswith("not kept: ConnectionError") for name, content in tool_messages(out)
    )
    assert "were not saved" in caplog.text


def test_the_person_is_asked_with_the_earlier_answers_found(database, fake_llm, monkeypatch):
    monkeypatch.setattr(erp, "get_material", lambda code: MATERIAL)
    earlier_answer()
    earlier_answer(run="older", scope="global", answer="Every product: ppb on this CoA is ppm.")
    fake_llm(*UNTIL_COMPARE, *ASK)
    (question,) = asked()
    first, second = question["precedents"]
    assert (first["match"], first["answer"], first["by"], first["summary"]) == (
        "same_product",
        "It is ppm.",
        "QA Marco",
        RULE,
    )
    assert second["match"] == "similar" and second["answer"].startswith("Every product")
    assert first["run_id"] == "old" and first["at"] > 0
    assert {"test", "reason", "supplier_result", "plant_requirement"} <= set(question)


def test_the_run_asks_a_person_even_when_the_memory_cannot_be_read(fake_llm, monkeypatch, caplog):
    monkeypatch.setattr(erp, "get_material", lambda code: MATERIAL)
    monkeypatch.setattr(memory, "vector_store", Mock(side_effect=ConnectionError("down")))
    fake_llm(*UNTIL_COMPARE, *ASK)
    assert asked()[0]["precedents"] == []
    assert "the memory was not read" in caplog.text


def test_a_person_is_not_asked_before_the_memory_is_checked(database, fake_llm, monkeypatch):
    monkeypatch.setattr(erp, "get_material", lambda code: MATERIAL)
    fake_llm(*UNTIL_COMPARE, call("resolve_questions"), *ASK)
    checked, config, out = paused_run()
    refused = next(m for m in checked.get_state(config).values["messages"] if m.type == "tool" and m.name == "resolve_questions")
    assert "call check_memory first" in refused.content
    assert out["__interrupt__"][0].value["questions"][0]["test"] == "Appearance"  # asked all the same, after check_memory


def test_nothing_is_looked_up_when_no_check_is_flagged(fake_llm, monkeypatch):
    monkeypatch.setattr(erp, "get_material", lambda code: MATERIAL)
    fake_llm(*check_sequence("review")[:COMPARED], call("check_memory"), call("write_summary"), call("render_ui"), SPEC, DONE)
    assert ("check_memory", "No check is flagged as unsure: nothing to look up.") in tool_messages(run())


@pytest.mark.parametrize(
    ("topic", "known"),
    [("unit_mismatch", "unit_mismatch"), ("Unit Mismatch", "unit_mismatch"), ("detection-limit", "detection_limit"), ("whatever", "other")],
)
def test_a_topic_the_model_makes_up_is_other(topic, known):
    assert schema.ClarificationNote(test="Lead", summary="Rule.", topic=topic).topic == known
