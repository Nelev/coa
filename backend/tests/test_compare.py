import json

from langchain_core.messages import AIMessage

from agent import agent
from agent.prompts import RENDER_UI_PROMPT
from schema import schema
from tests.conftest import CALL_USAGE

PLANT_SPEC = {
    "tests": [
        {"test": "Assay", "type": "numeric", "min": 99.5, "max": 100.5, "unit": "%"},
        {"test": "Water", "type": "numeric", "max": 0.4, "unit": "%"},
    ]
}
STATE = {
    "plant_spec": PLANT_SPEC,
    "tests": [
        {"test": "Assay", "result": "99.9", "unit": "%"},
        {"test": "Water", "result": "0.45", "unit": "%"},
    ],
}


def check(test, verdict="pass"):
    return schema.TestCheck(test=test, verdict=verdict, reason=f"{test} {verdict}")


def test_issues_are_derived_from_non_pass_checks(fake_llm):
    llm = fake_llm([check("Assay"), check("Water", "fail")])
    out = agent.compare_specs(STATE)
    assert llm.calls == 1
    assert [c["verdict"] for c in out["test_checks"]] == ["pass", "fail"]
    assert [(i["test"], i["kind"], i["severity"]) for i in out["issues"]] == [("Water", "non_conforming", "critical")]
    assert {k: out[k] for k in CALL_USAGE} == CALL_USAGE


def test_review_verdict_becomes_warning(fake_llm):
    fake_llm([check("Assay", "review"), check("Water")])
    issue = agent.compare_specs(STATE)["issues"][0]
    assert (issue["kind"], issue["severity"]) == ("needs_review", "warning")


def test_missing_test_is_retried_then_flagged_for_review(fake_llm):
    llm = fake_llm([check("Assay")], [check("Assay")])  # the model never returns "Water"
    out = agent.compare_specs(STATE)
    assert llm.calls == 2
    water = next(c for c in out["test_checks"] if c["test"] == "Water")
    assert water["verdict"] == "review"
    assert water["plant_requirement"] == "max 0.4 %"
    assert [i["test"] for i in out["issues"]] == ["Water"]


def test_renamed_and_extra_tests_are_dropped(fake_llm):
    fake_llm([check("Assay"), check("Moisture")], [check("Assay"), check("Moisture")])
    out = agent.compare_specs(STATE)
    assert [(c["test"], c["verdict"]) for c in out["test_checks"]] == [("Assay", "pass"), ("Water", "review")]


def test_retry_recovers_when_second_response_is_complete(fake_llm):
    llm = fake_llm([check("Assay")], [check("Assay"), check("Water")])
    out = agent.compare_specs(STATE)
    assert llm.calls == 2
    assert out["issues"] == []
    assert out["cost"] == 2 * CALL_USAGE["cost"]  # the retry is paid for too
    assert out["input_tokens"] == 2 * CALL_USAGE["input_tokens"]


STATE_WITH_MESSAGE = {"messages": [AIMessage("Lot 42 is non-conforming.")], "issues": []}
VALID_SPEC = '{"root": "a", "elements": {"a": {"type": "Text", "props": {"text": "hi"}, "children": []}}}'


def test_render_ui_parses_the_spec_even_inside_code_fences(fake_llm):
    llm = fake_llm(f"```json\n{VALID_SPEC}\n```")
    out = agent.render_ui(STATE_WITH_MESSAGE)
    assert out["ui_spec"]["root"] == "a"
    assert llm.calls == 1
    assert out["cost"] == CALL_USAGE["cost"]


def test_render_ui_retries_once_on_invalid_json(fake_llm):
    llm = fake_llm("not json", VALID_SPEC)
    out = agent.render_ui(STATE_WITH_MESSAGE)
    assert out["ui_spec"]["root"] == "a"
    assert llm.calls == 2
    assert (out["cost"], out["output_tokens"]) == (2 * CALL_USAGE["cost"], 2 * CALL_USAGE["output_tokens"])


def test_render_ui_falls_back_to_an_error_alert(fake_llm):
    fake_llm("not json", '{"root": "missing", "elements": {}}')
    spec = agent.render_ui(STATE_WITH_MESSAGE)["ui_spec"]
    assert spec["elements"][spec["root"]]["type"] == "Alert"


def test_render_ui_sends_the_prompt_and_the_last_message_to_the_model(fake_llm):
    llm = fake_llm(VALID_SPEC)
    state = {"messages": [AIMessage("first"), AIMessage("last message")], "issues": []}
    agent.render_ui(state)
    assert llm.prompts == [f"{RENDER_UI_PROMPT}\nlast message"]


def test_a_call_without_usage_or_cost_adds_nothing():
    assert agent._usage(AIMessage("ok")) == {"cost": 0.0, "input_tokens": 0, "output_tokens": 0}


def test_write_summary_puts_the_outcome_and_the_data_in_the_last_message():
    issue = {"kind": "non_conforming", "severity": "critical", "message": "Too wet.", "test": "Water"}
    check = {"test": "Water", "verdict": "fail", "reason": "r", "supplier_result": "0.6 %", "plant_requirement": "max 0.4 %"}
    state = {"supplier_materials": {"lot": "L1"}, "test_checks": [check], "issues": [issue]}
    summary = json.loads(agent.write_summary(state)["messages"][-1].content)
    assert summary["outcome"] == "Non-conforming"
    assert summary["header"] == {"lot": "L1"}
    assert summary["tests"] == [{"test": "Water", "verdict": "fail", "supplier_result": "0.6 %", "plant_requirement": "max 0.4 %"}]
    assert summary["issues"] == [issue]


def test_outcome_is_needs_review_for_warnings_and_conforming_without_issues():
    warning = {"kind": "needs_review", "severity": "warning", "message": "m", "test": "t"}
    assert agent._outcome([warning]) == "Needs review"
    assert agent._outcome([]) == "Conforming"


def test_the_summary_counts_the_verdicts():
    verdicts = [("a", "pass"), ("b", "pass"), ("c", "fail")]
    checks = [{"test": t, "verdict": v, "supplier_result": "x", "plant_requirement": "y"} for t, v in verdicts]
    summary = json.loads(agent.write_summary({"test_checks": checks, "issues": []})["messages"][0].content)
    assert summary["counts"] == {"pass": 2, "fail": 1, "review": 0}
