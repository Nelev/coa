import json

from langchain_core.messages import AIMessage

from agent import agent
from agent.prompts import RENDER_UI_PROMPT
from schema import schema

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


def test_unknown_product_code_records_issue_and_skips_comparison(monkeypatch, tmp_path):
    specs = tmp_path / "specs.json"
    specs.write_text('{"materials": {}}')
    monkeypatch.setattr(agent, "PLANT_SPECS_PATH", specs)
    out = agent.load_plant_spec({"supplier_materials": {"product_code": "XX-1"}})
    assert out["issues"][0]["kind"] == "missing_plant_spec"
    assert agent.route_after_plant_spec(out) == "write_summary"


def test_known_product_code_routes_to_comparison(monkeypatch, tmp_path):
    specs = tmp_path / "specs.json"
    specs.write_text('{"materials": {"CA-ANH-25": {"name": "Citric Acid", "tests": []}}}')
    monkeypatch.setattr(agent, "PLANT_SPECS_PATH", specs)
    out = agent.load_plant_spec({"supplier_materials": {"product_code": "CA-ANH-25"}})
    assert out["plant_spec"]["name"] == "Citric Acid"
    assert agent.route_after_plant_spec(out) == "compare_specs"


STATE_WITH_MESSAGE = {"messages": [AIMessage("Lot 42 is non-conforming.")], "issues": []}
VALID_SPEC = '{"root": "a", "elements": {"a": {"type": "Text", "props": {"text": "hi"}, "children": []}}}'


def test_render_ui_parses_the_spec_even_inside_code_fences(fake_llm):
    llm = fake_llm(f"```json\n{VALID_SPEC}\n```")
    out = agent.render_ui(STATE_WITH_MESSAGE)
    assert out["ui_spec"]["root"] == "a"
    assert llm.calls == 1


def test_render_ui_retries_once_on_invalid_json(fake_llm):
    llm = fake_llm("not json", VALID_SPEC)
    assert agent.render_ui(STATE_WITH_MESSAGE)["ui_spec"]["root"] == "a"
    assert llm.calls == 2


def test_render_ui_falls_back_to_an_error_alert(fake_llm):
    fake_llm("not json", '{"root": "missing", "elements": {}}')
    spec = agent.render_ui(STATE_WITH_MESSAGE)["ui_spec"]
    assert spec["elements"][spec["root"]]["type"] == "Alert"


def test_render_ui_sends_the_prompt_and_the_last_message_to_the_model(fake_llm):
    llm = fake_llm(VALID_SPEC)
    state = {"messages": [AIMessage("first"), AIMessage("last message")], "issues": []}
    agent.render_ui(state)
    assert llm.prompts == [f"{RENDER_UI_PROMPT}\nlast message"]


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
