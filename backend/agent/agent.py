import json
import os
from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv
from langchain_openai import ChatOpenAI
from langgraph.graph import END, START, StateGraph
from pypdf import PdfReader

from schema.schema import CoAData, ComparisonResult, Issue, TestCheck
from .state import AgentState

load_dotenv()


EXTRACTION_PROMPT = (
    "You are reading a supplier Certificate of Analysis (CoA). Extract its data exactly as written.\n"
    "- Copy values verbatim; never infer, correct, convert or round them.\n"
    "- Use null for anything the document does not state.\n"
    "- Every row of the analytical results table is one test; do not mix header fields into the tests.\n\n"
    "Document:\n"
)


COMPARE_PROMPT = (
    "You are an incoming-quality-control reviewer at a plant. Compare the results on a supplier "
    "Certificate of Analysis with the PLANT requirements for the material. Judge against the plant "
    "requirements only, never against the supplier's own limits.\n"
    "- Return exactly one check for every test in the plant requirements, using its test name verbatim.\n"
    "- Limits are inclusive: a value equal to a limit passes.\n"
    "- A result written as '< x' passes a max limit only if x <= max. Against a min limit it cannot be "
    "confirmed, so the verdict is review.\n"
    "- If the CoA unit differs from the plant unit, the verdict is review. Never convert units silently.\n"
    "- Qualitative tests pass only if the CoA result is one of the accepted words (case-insensitive). "
    "Any other result is review, never an assumed pass.\n"
    "- A plant-required test that is not reported on the CoA is fail, with the reason 'not reported'.\n"
    "- Ignore CoA tests that the plant does not require.\n"
    "- Quote numbers verbatim in the reason; never round or restate them. For fail and review, say in "
    "the same sentence why (e.g. 'exceeds the maximum', 'below the minimum', 'not an accepted result').\n"
    "- Verdicts: pass = meets the requirement; fail = clearly violates it or is missing; "
    "review = cannot be decided automatically.\n\n"
)

DOCS_DIR = Path(__file__).resolve().parent.parent / "docs"
PLANT_SPECS_PATH = DOCS_DIR / "plant_specs.json"

# check verdict -> (issue kind, issue severity); a pass raises no issue
VERDICT_ISSUE = {"fail": ("non_conforming", "critical"), "review": ("needs_review", "warning")}


@lru_cache
def get_llm() -> ChatOpenAI:
    return ChatOpenAI(
        model="openai/gpt-5-mini",
        api_key=os.environ["OPENROUTER_API_KEY"],
        base_url="https://openrouter.ai/api/v1",
    )


def load_document(state: AgentState) -> dict:
    """Extract the text of the PDF at `document_path`."""
    reader = PdfReader(state["document_path"])
    text = "\n".join(page.extract_text() or "" for page in reader.pages)
    return {"document_text": text}


def get_document_data(state: AgentState) -> dict:
    """Extract the CoA header, specifications and reported results from the document text."""
    coa = get_llm().with_structured_output(CoAData).invoke(EXTRACTION_PROMPT + state["document_text"])

    return {
        "supplier_materials": {k: v for k, v in coa.header.model_dump().items() if v is not None},
        "spec_values": {t.test: t.specification for t in coa.tests if t.specification},
        "tests": [t.model_dump() for t in coa.tests],
    }


@lru_cache
def _load_plant_specs(path: Path) -> dict:
    return json.loads(path.read_text())["materials"]


def load_plant_spec(state: AgentState) -> dict:
    """Select the plant requirements for the CoA's product code."""
    product_code = state["supplier_materials"].get("product_code")
    material = _load_plant_specs(PLANT_SPECS_PATH).get(product_code)
    if material is None:
        issue = Issue(kind="missing_plant_spec", severity="critical",
                      message=f"No plant specification found for product code {product_code!r}.")
        return {"issues": [issue.model_dump()]}
    return {"plant_spec": material}


def route_after_plant_spec(state: AgentState) -> str:
    return "compare_specs" if state.get("plant_spec") else END


def _plant_requirement(test: dict) -> str:
    if test["type"] == "qualitative":
        return f"{test['requirement']} (accepted: {', '.join(test['accepted'])})"
    limits = [f"{bound} {test[bound]}" for bound in ("min", "max") if bound in test]
    return f"{', '.join(limits)} {test['unit']}"


def _supplier_result(test: dict) -> str:
    return f"{test['result']} {test['unit']}" if test["unit"] else test["result"]


def _ask(llm, prompt: str) -> dict[str, TestCheck]:
    return {c.test: c for c in llm.invoke(prompt).checks}


def compare_specs(state: AgentState) -> dict:
    """Ask the model to compare each CoA result with the plant requirements, then derive issues."""
    plant_tests = state["plant_spec"]["tests"]
    expected = {t["test"] for t in plant_tests}
    coa_tests = [{k: t[k] for k in ("test", "result", "unit")} for t in state["tests"]]
    prompt = (
        COMPARE_PROMPT
        + "Plant requirements:\n" + json.dumps(plant_tests, ensure_ascii=False, separators=(",", ":"))
        + "\n\nCoA results:\n" + json.dumps(coa_tests, ensure_ascii=False, separators=(",", ":"))
    )

    llm = get_llm().with_structured_output(ComparisonResult)
    checks = _ask(llm, prompt)
    if set(checks) != expected:  # one retry, telling the model what was wrong
        checks = _ask(llm, (
            prompt + f"\n\nYour previous answer did not match the plant tests (missing: {sorted(expected - set(checks))}; "
            f"unexpected: {sorted(set(checks) - expected)}). Return exactly one check per plant test, names verbatim."
        ))

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
    return {"test_checks": test_checks, "issues": issues}


graph = StateGraph(AgentState)

graph.add_node("load_document", load_document)
graph.add_node("get_document_data", get_document_data)
graph.add_edge(START, "load_document")
graph.add_edge("load_document", "get_document_data")
graph.add_node("load_plant_spec", load_plant_spec)
graph.add_node("compare_specs", compare_specs)
graph.add_edge("get_document_data", "load_plant_spec")
graph.add_conditional_edges("load_plant_spec", route_after_plant_spec, ["compare_specs", END])
graph.add_edge("compare_specs", END)

app = graph.compile()


if __name__ == "__main__":
    import sys

    default_doc = DOCS_DIR / "sample_coa_citric_acid.pdf"
    result = app.invoke({"document_path": sys.argv[1] if len(sys.argv) > 1 else str(default_doc)})

    print("== Header ==")
    for key, value in result["supplier_materials"].items():
        print(f"{key}: {value}")
    print("\n== Tests (result | specification) ==")
    for test in result["tests"]:
        print(f"{test['test']}: {_supplier_result(test)} | {result['spec_values'].get(test['test'], '-')}")

    print("\n== Plant comparison ==")
    for check in result.get("test_checks", []):
        print(f"[{check['verdict'].upper():6}] {check['test']}: {check['reason']}")
    print(f"\n== Issues ({len(result['issues'])}) ==")
    for issue in result["issues"]:
        print(f"[{issue['severity']}] {issue['test'] or '-'}: {issue['message']}")
