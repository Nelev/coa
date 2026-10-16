import json
import os
from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv
from langchain_core.messages import AIMessage
from langchain_core.utils.json import parse_json_markdown
from langchain_openai import ChatOpenAI
from langgraph.config import get_stream_writer
from langgraph.graph import END, START, StateGraph
from pypdf import PdfReader

import erp
from schema.schema import CoAData, ComparisonResult, DocumentCheck, Issue, TestCheck

from .prompts import COMPARE_PROMPT, EXTRACTION_PROMPT, RENDER_UI_PROMPT, VALIDATE_PROMPT
from .state import AgentState

load_dotenv()


def _alert_spec(title: str, message: str) -> dict:
    """A json-render spec holding a single error Alert."""
    alert = {"title": title, "message": message, "type": "error"}
    return {"root": "alert", "elements": {"alert": {"type": "Alert", "props": alert, "children": []}}}


FALLBACK_UI_SPEC = _alert_spec("The report could not be generated", "The model did not return a valid layout. Run the agent again.")

VALIDATION_CHARS = 6000  # the start of a document is enough to tell what kind it is

DOCS_DIR = Path(__file__).resolve().parent.parent / "docs"

# check verdict -> (issue kind, issue severity); a pass raises no issue
VERDICT_ISSUE = {"fail": ("non_conforming", "critical"), "review": ("needs_review", "warning")}


def _status(text: str) -> None:
    """Tell the client what the running node is doing; /analyze streams it as {"status": text}."""
    get_stream_writer()({"status": text})


NO_USAGE = {"cost": 0.0, "input_tokens": 0, "output_tokens": 0}  # also the keys of a usage dict


def _usage(message: AIMessage) -> dict:
    """What one model call used: its tokens, and the cost OpenRouter charged for it (0 when the provider does not say)."""
    tokens = message.usage_metadata or {}
    cost = (message.response_metadata.get("token_usage") or {}).get("cost") or 0.0
    return {"cost": cost, "input_tokens": tokens.get("input_tokens", 0), "output_tokens": tokens.get("output_tokens", 0)}


def _sum_usage(*usages: dict) -> dict:
    return {key: sum(u[key] for u in usages) for key in NO_USAGE}


def _ask_structured(llm, schema, prompt: str):
    """Call the model for a `schema` result; returns it with the call's usage."""
    out = llm.with_structured_output(schema, include_raw=True).invoke(prompt)
    if out["parsed"] is None:
        raise out["parsing_error"]
    return out["parsed"], _usage(out["raw"])


@lru_cache
def get_llm() -> ChatOpenAI:
    return ChatOpenAI(
        model="openai/gpt-5-mini",
        api_key=os.environ["OPENROUTER_API_KEY"],
        base_url="https://openrouter.ai/api/v1",
    )


def load_document(state: AgentState) -> dict:
    """Extract the text of the PDF at `document_path`."""
    _status("Reading the PDF")
    reader = PdfReader(state["document_path"])
    text = "\n".join(page.extract_text() or "" for page in reader.pages)
    return {"document_text": text}


def _not_a_coa(state: AgentState) -> dict | None:
    return next((i for i in state.get("issues", []) if i["kind"] == "not_a_coa"), None)


def validate_document(state: AgentState) -> dict:
    """Check that the document is a CoA; if not, record a `not_a_coa` issue."""
    _status("Checking it is a CoA")
    text = state["document_text"]
    if text.strip():
        check, usage = _ask_structured(get_llm(), DocumentCheck, VALIDATE_PROMPT + text[:VALIDATION_CHARS])
    else:
        check, usage = DocumentCheck(is_coa=False, reason="The PDF has no extractable text (it may be a scan)."), NO_USAGE
    if check.is_coa:
        return usage
    return {**usage, "issues": [Issue(kind="not_a_coa", severity="critical", message=check.reason).model_dump()]}


def route_after_validation(state: AgentState) -> str:
    return "render_ui" if _not_a_coa(state) else "get_document_data"


def get_document_data(state: AgentState) -> dict:
    """Extract the CoA header, specifications and reported results from the document text."""
    _status("Extracting the CoA data")
    coa, usage = _ask_structured(get_llm(), CoAData, EXTRACTION_PROMPT + state["document_text"])

    return {
        **usage,
        "supplier_materials": {k: v for k, v in coa.header.model_dump().items() if v is not None},
        "spec_values": {t.test: t.specification for t in coa.tests if t.specification},
        "tests": [t.model_dump() for t in coa.tests],
    }


def load_plant_spec(state: AgentState) -> dict:
    """Select the plant requirements for the CoA's product code."""
    _status("Finding the plant specification")
    product_code = state["supplier_materials"].get("product_code")
    material = erp.get_material(product_code)
    if material is None:
        issue = Issue(
            kind="missing_plant_spec", severity="critical", message=f"No plant specification found for product code {product_code!r}."
        )
        return {"issues": [issue.model_dump()]}
    return {"plant_spec": material}


def route_after_plant_spec(state: AgentState) -> str:
    return "compare_specs" if state.get("plant_spec") else "write_summary"


def _plant_requirement(test: dict) -> str:
    if test["type"] == "qualitative":
        return f"{test['requirement']} (accepted: {', '.join(test['accepted'])})"
    limits = [f"{bound} {test[bound]}" for bound in ("min", "max") if bound in test]
    return f"{', '.join(limits)} {test['unit']}"


def _supplier_result(test: dict) -> str:
    return f"{test['result']} {test['unit']}" if test["unit"] else test["result"]


def _ask(llm, prompt: str) -> tuple[dict[str, TestCheck], dict]:
    result, usage = _ask_structured(llm, ComparisonResult, prompt)
    return {c.test: c for c in result.checks}, usage


def compare_specs(state: AgentState) -> dict:
    """Ask the model to compare each CoA result with the plant requirements, then derive issues."""
    _status("Comparing results with the specification")
    plant_tests = state["plant_spec"]["tests"]
    expected = {t["test"] for t in plant_tests}
    coa_tests = [{k: t[k] for k in ("test", "result", "unit")} for t in state["tests"]]
    prompt = (
        COMPARE_PROMPT
        + "Plant requirements:\n"
        + json.dumps(plant_tests, ensure_ascii=False, separators=(",", ":"))
        + "\n\nCoA results:\n"
        + json.dumps(coa_tests, ensure_ascii=False, separators=(",", ":"))
    )

    llm = get_llm()
    checks, usage = _ask(llm, prompt)
    if set(checks) != expected:  # one retry, telling the model what was wrong
        checks, retry_usage = _ask(
            llm,
            (
                prompt + f"\n\nYour previous answer did not match the plant tests (missing: {sorted(expected - set(checks))}; "
                f"unexpected: {sorted(set(checks) - expected)}). Return exactly one check per plant test, names verbatim."
            ),
        )
        usage = _sum_usage(usage, retry_usage)

    supplier_results = {t["test"]: _supplier_result(t) for t in state["tests"]}
    test_checks, issues = [], []
    for plant_test in plant_tests:
        name = plant_test["test"]
        check = checks.get(name) or TestCheck(test=name, verdict="review", reason="The model returned no verdict for this test.")
        details = {"supplier_result": supplier_results.get(name), "plant_requirement": _plant_requirement(plant_test)}
        test_checks.append({**check.model_dump(), **details})
        if check.verdict != "pass":
            kind, severity = VERDICT_ISSUE[check.verdict]
            issues.append(Issue(kind=kind, severity=severity, message=check.reason, test=name, **details).model_dump())
    return {**usage, "test_checks": test_checks, "issues": issues}


NON_CONFORMING = "Non-conforming"
NOT_A_COA = "Not a CoA"


def _outcome(issues: list[dict]) -> str:
    if any(i["severity"] == "critical" for i in issues):
        return NON_CONFORMING
    return "Needs review" if issues else "Conforming"


def _result(outcome: str, checks: list[dict], header: dict) -> dict:
    """The few facts the job list shows without opening the report."""
    counts = {verdict: sum(c["verdict"] == verdict for c in checks) for verdict in ("pass", "fail", "review")}
    return {
        "outcome": outcome,
        "counts": counts,
        "product": header.get("product_name"),
        "lot": header.get("lot_number"),
        "supplier": header.get("supplier"),
    }


def write_summary(state: AgentState) -> dict:
    """Write the agent's final message: the outcome, certificate header, test results and issues, as compact JSON."""
    _status("Summarizing the findings")
    issues = state.get("issues", [])
    checks = state.get("test_checks", [])
    header = state.get("supplier_materials", {})
    result = _result(_outcome(issues), checks, header)
    summary = {
        "outcome": result["outcome"],
        "counts": result["counts"],
        "header": header,
        "tests": [{k: c[k] for k in ("test", "verdict", "supplier_result", "plant_requirement")} for c in checks],
        "issues": issues,
    }
    return {"messages": [AIMessage(json.dumps(summary, ensure_ascii=False, separators=(",", ":")))], "result": result}


def render_ui(state: AgentState) -> dict:
    """Ask the model to build a json-render UI spec from the agent's last message (no model call for a document that is not a CoA)."""
    _status("Building the report")
    if rejection := _not_a_coa(state):
        spec = _alert_spec("This document is not a Certificate of Analysis", rejection["message"])
        return {"ui_spec": spec, "result": _result(NOT_A_COA, [], {})}
    prompt = f"{RENDER_UI_PROMPT}\n{state['messages'][-1].content}"
    feedback = ""
    usage = NO_USAGE
    for _ in range(2):  # one retry, telling the model what was wrong
        reply = get_llm().invoke(prompt + feedback)
        usage = _sum_usage(usage, _usage(reply))
        try:
            spec = parse_json_markdown(reply.content)
        except ValueError as error:
            feedback = f"\n\nYour previous reply was not valid JSON ({error}). Reply with only the JSON object."
            continue
        if isinstance(spec, dict) and isinstance(spec.get("elements"), dict) and spec.get("root") in spec["elements"]:
            return {**usage, "ui_spec": spec}
        feedback = '\n\nYour previous reply was not a spec with a "root" key that exists in "elements". Reply with only the JSON object.'
    return {**usage, "ui_spec": FALLBACK_UI_SPEC}


graph = StateGraph(AgentState)

graph.add_node("load_document", load_document)
graph.add_node("validate_document", validate_document)
graph.add_node("get_document_data", get_document_data)
graph.add_edge(START, "load_document")
graph.add_edge("load_document", "validate_document")
graph.add_conditional_edges("validate_document", route_after_validation, ["get_document_data", "render_ui"])
graph.add_node("load_plant_spec", load_plant_spec)
graph.add_node("compare_specs", compare_specs)
graph.add_edge("get_document_data", "load_plant_spec")
graph.add_node("write_summary", write_summary)
graph.add_node("render_ui", render_ui)
graph.add_conditional_edges("load_plant_spec", route_after_plant_spec, ["compare_specs", "write_summary"])
graph.add_edge("compare_specs", "write_summary")
graph.add_edge("write_summary", "render_ui")
graph.add_edge("render_ui", END)

app = graph.compile()


if __name__ == "__main__":
    import sys

    default_doc = DOCS_DIR / "sample_coa_citric_acid.pdf"
    result = app.invoke({"document_path": sys.argv[1] if len(sys.argv) > 1 else str(default_doc)})

    print("== Header ==")
    for key, value in result.get("supplier_materials", {}).items():
        print(f"{key}: {value}")
    print("\n== Tests (result | specification) ==")
    for test in result.get("tests", []):
        print(f"{test['test']}: {_supplier_result(test)} | {result.get('spec_values', {}).get(test['test'], '-')}")

    print("\n== Plant comparison ==")
    for check in result.get("test_checks", []):
        print(f"[{check['verdict'].upper():6}] {check['test']}: {check['reason']}")
    print(f"\n== Issues ({len(result.get('issues', []))}) ==")
    for issue in result.get("issues", []):
        print(f"[{issue['severity']}] {issue['test'] or '-'}: {issue['message']}")
