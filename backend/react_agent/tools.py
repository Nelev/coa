"""The steps of the CoA check as LangChain tools for a ReAct agent (react_agent.py); it does not use agent/agent.py.

A tool returns a Command: its state update plus a short ToolMessage for the model. The data (document text, tests, UI spec) stays in
the state. The order the graph's edges fixed is the model's choice; a tool called too early raises OutOfOrder, which the tools node
answers with a message saying what to call first.

load_plant_spec is the graph's load_plant_spec and save_plant_spec in one tool, so the model does not have to call a pair in order.
notify_quality_team replaces send_email: told to mail only a non-conforming lot, the model mailed a conforming one in every live run,
so the tool takes no arguments, builds the mail from the state and refuses any other outcome.
compare_specs keeps the checks the model flagged as unsure (with its reason); resolve_questions asks a person about them with
interrupt() and judges those tests again with the answer. It is its own tool because a resumed run starts the interrupted tool over:
the model calls of compare_specs must not run twice.
check_memory looks in the memory (memory.py, a LangChain vector store) for what a person answered when a check like each flagged one came
up, and gives it to the person who is asked; resolve_questions waits for it. remember_clarifications keeps what a person answered, with a
summary and a topic of the model's and an embedding, in the same memory. Both take no arguments, like notify_quality_team, and the second
is a tool of its own for the same reason as resolve_questions: its model call and its embeddings must not run again when the run resumes.
"""

import json
import logging
import os
from functools import lru_cache
from typing import Annotated

from dotenv import load_dotenv
from langchain_core.messages import AIMessage, ToolMessage
from langchain_core.tools import InjectedToolCallId, tool
from langchain_core.utils.json import parse_json_markdown
from langchain_openai import ChatOpenAI
from langgraph.config import get_stream_writer
from langgraph.prebuilt import InjectedState
from langgraph.types import Command, interrupt
from pypdf import PdfReader

import notify
from agent.tools import get_material, send_email
from schema.schema import DEFAULT_SCOPE, ClarificationNotes, CoAData, ComparisonResult, DocumentCheck, Issue, TestCheck

from . import memory
from .const import (
    FALLBACK_UI_SPEC,
    MAX_OUTPUT_TOKENS,
    MAX_PAGES,
    NO_USAGE,
    NON_CONFORMING,
    NOT_A_COA,
    REPORTED,
    VALIDATION_CHARS,
    VERDICT_ISSUE,
)
from .prompts import COMPARE_PROMPT, EXTRACTION_PROMPT, NOTES_PROMPT, RENDER_UI_PROMPT, VALIDATE_PROMPT

load_dotenv()

logger = logging.getLogger(__name__)

State = Annotated[dict, InjectedState]  # not AgentState: the tool's input is validated, and a state still being filled lacks keys
CallId = Annotated[str, InjectedToolCallId]


def _alert_spec(title: str, message: str) -> dict:
    """A json-render spec holding a single error Alert."""
    alert = {"title": title, "message": message, "type": "error"}
    return {"root": "alert", "elements": {"alert": {"type": "Alert", "props": alert, "children": []}}}


@lru_cache
def get_llm() -> ChatOpenAI:
    return ChatOpenAI(
        model="openai/gpt-5-mini",
        api_key=os.environ["OPENROUTER_API_KEY"],
        base_url="https://openrouter.ai/api/v1",
        max_tokens=MAX_OUTPUT_TOKENS,
    )


def _status(text: str) -> None:
    """Tell the client what the running tool is doing; /analyze streams it as {"status": text}."""
    get_stream_writer()({"status": text})


def call_usage(message: AIMessage) -> dict:
    """What one model call used: its tokens, and the cost OpenRouter charged for it (0 when the provider does not say)."""
    tokens = message.usage_metadata or {}
    cost = (message.response_metadata.get("token_usage") or {}).get("cost") or 0.0
    return {"cost": cost, "input_tokens": tokens.get("input_tokens", 0), "output_tokens": tokens.get("output_tokens", 0)}


def _sum_usage(*usages: dict) -> dict:
    return {key: sum(u[key] for u in usages) for key in NO_USAGE}


def _ask_structured(schema, prompt: str):
    """Call the model for a `schema` result; returns it with the call's usage."""
    out = get_llm().with_structured_output(schema, include_raw=True).invoke(prompt)
    if out["parsed"] is None:
        raise out["parsing_error"]
    return out["parsed"], call_usage(out["raw"])


class OutOfOrder(Exception):
    """A tool was called before the one it needs: the tools node answers the call with the message, so the model can call the right one."""


def _need(state: dict, key: str, first: str) -> None:
    """Raise when a tool runs before the one that produces `key`."""
    if key not in state:
        raise OutOfOrder(f"There is no {key} yet: call {first} first.")


def _not_waiting(state: dict) -> None:
    """Raise while checks flagged as unsure still wait for a person."""
    if open_questions := state.get("open_questions"):
        raise OutOfOrder(f"{len(open_questions)} check(s) flagged as unsure still wait for a person: call resolve_questions first.")


def _reply(update: dict, tool_call_id: str, name: str, content: str) -> Command:
    """Apply a step's state update and answer the call with `content`."""
    return Command(update={**update, "messages": [ToolMessage(content, name=name, tool_call_id=tool_call_id)]})


def _json(value) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def _issue(**fields) -> dict:
    return Issue(**fields).model_dump()


def _plant_requirement(test: dict) -> str:
    if test["type"] == "qualitative":
        return f"{test['requirement']} (accepted: {', '.join(test['accepted'])})"
    limits = [f"{bound} {test[bound]}" for bound in ("min", "max") if bound in test]
    return f"{', '.join(limits)} {test['unit']}"


def _supplier_result(test: dict) -> str:
    return f"{test['result']} {test['unit']}" if test["unit"] else test["result"]


def _ask_checks(prompt: str) -> tuple[dict[str, TestCheck], dict]:
    result, usage = _ask_structured(ComparisonResult, prompt)
    return {c.test: c for c in result.checks}, usage


def _counts(checks: list[dict]) -> dict:
    return {verdict: sum(c["verdict"] == verdict for c in checks) for verdict in ("pass", "fail", "review")}


def _outcome(issues: list[dict]) -> str:
    if any(i["severity"] == "critical" for i in issues):
        return NON_CONFORMING
    return "Needs review" if issues else "Conforming"


def _summary(state: dict) -> dict:
    """The findings so far: the outcome, certificate header, test results and issues."""
    issues = state.get("issues", [])
    checks = state.get("test_checks", [])
    return {
        "outcome": _outcome(issues),
        "counts": _counts(checks),
        "header": state.get("supplier_materials", {}),
        "tests": [{k: c[k] for k in ("test", "verdict", "supplier_result", "plant_requirement")} for c in checks],
        "issues": issues,
        "clarifications": [{k: c[k] for k in REPORTED if c.get(k) is not None} for c in state.get("clarifications", [])],
    }


def _result(outcome: str, checks: list[dict], header: dict) -> dict:
    """The few facts the job list shows without opening the report."""
    return {
        "outcome": outcome,
        "counts": _counts(checks),
        "product": header.get("product_name"),
        "lot": header.get("lot_number"),
        "supplier": header.get("supplier"),
    }


@tool
def load_document(state: State, tool_call_id: CallId) -> Command:
    """Read the text of the uploaded PDF. This is the first step: every other step works on the text it keeps."""
    _status("Reading the PDF")
    reader = PdfReader(state["document_path"])
    if len(reader.pages) > MAX_PAGES:
        raise ValueError(f"the PDF has {len(reader.pages)} pages: a certificate of more than {MAX_PAGES} is not accepted")
    text = "\n".join(page.extract_text() or "" for page in reader.pages)
    return _reply({"document_text": text}, tool_call_id, "load_document", f"Read {len(text)} characters from the PDF.")


@tool
def validate_document(state: State, tool_call_id: CallId) -> Command:
    """Check that the document is a supplier Certificate of Analysis (CoA).

    A document that is not a CoA (an invoice, a data sheet, a scan with no text) is recorded as a critical issue: skip the
    data extraction and the comparison and go to render_ui.
    """
    _need(state, "document_text", "load_document")
    _status("Checking it is a CoA")
    text = state["document_text"]
    if text.strip():
        check, usage = _ask_structured(DocumentCheck, VALIDATE_PROMPT + text[:VALIDATION_CHARS])
    else:
        check, usage = DocumentCheck(is_coa=False, reason="The PDF has no extractable text (it may be a scan)."), NO_USAGE
    if check.is_coa:
        return _reply(usage, tool_call_id, "validate_document", "The document is a CoA.")
    issue = _issue(kind="not_a_coa", severity="critical", message=check.reason)
    return _reply({**usage, "issues": [issue]}, tool_call_id, "validate_document", f"Not a CoA: {check.reason}")


@tool
def get_document_data(state: State, tool_call_id: CallId) -> Command:
    """Extract the CoA's header (product code, lot, dates, supplier, ...) and its table of test results from the document text."""
    _need(state, "document_text", "load_document")
    _status("Extracting the CoA data")
    coa, usage = _ask_structured(CoAData, EXTRACTION_PROMPT + state["document_text"])
    header = {k: v for k, v in coa.header.model_dump().items() if v is not None}
    update = {
        **usage,
        "supplier_materials": header,
        "spec_values": {t.test: t.specification for t in coa.tests if t.specification},
        "tests": [t.model_dump() for t in coa.tests],
    }
    return _reply(update, tool_call_id, "get_document_data", f"Header: {_json(header)}\nTests extracted: {len(coa.tests)}")


@tool
def load_plant_spec(state: State, tool_call_id: CallId) -> Command:
    """Look up the plant's requirements for the CoA's product code in the ERP (runs get_material for you).

    A certificate with no product code, or a product code the ERP does not know, is recorded as a critical issue: skip
    compare_specs and go to write_summary. An ERP that cannot be reached raises: it is not a missing specification.
    """
    _need(state, "supplier_materials", "get_document_data")
    _status("Finding the plant specification")
    product_code = state["supplier_materials"].get("product_code")
    material = get_material.invoke({"product_code": product_code}) if product_code else None  # without a code there is nothing to look up
    if material is None:
        message = f"No plant specification found for product code {product_code!r}."
        update = {"issues": [_issue(kind="missing_plant_spec", severity="critical", message=message)]}
        return _reply(update, tool_call_id, "load_plant_spec", message)
    content = f"Found the plant specification for {product_code!r}: {len(material['tests'])} required tests."
    return _reply({"plant_spec": material}, tool_call_id, "load_plant_spec", content)


def _coa_tests(tests: list[dict], only: set[str] | None = None) -> list[dict]:
    """What the model may see of the CoA's results (not the supplier's own limits or pass/fail), of the tests in `only` if given."""
    return [{k: t[k] for k in ("test", "result", "unit")} for t in tests if only is None or t["test"] in only]


def _judge(plant_tests: list[dict], coa_tests: list[dict], extra: str = "") -> tuple[dict[str, TestCheck], dict]:
    """One verdict per plant test from the model, with one retry telling it what was wrong; `extra` is added to the prompt."""
    expected = {t["test"] for t in plant_tests}
    prompt = COMPARE_PROMPT + "Plant requirements:\n" + _json(plant_tests) + "\n\nCoA results:\n" + _json(coa_tests) + extra
    checks, usage = _ask_checks(prompt)
    if set(checks) != expected:
        checks, retry_usage = _ask_checks(
            prompt + f"\n\nYour previous answer did not match the plant tests (missing: {sorted(expected - set(checks))}; "
            f"unexpected: {sorted(set(checks) - expected)}). Return exactly one check per plant test, names verbatim."
        )
        usage = _sum_usage(usage, retry_usage)
    return checks, usage


def _verdicts(plant_tests: list[dict], checks: dict[str, TestCheck], coa_tests: list[dict]) -> tuple[list[dict], list[dict]]:
    """The test_checks and issues of `plant_tests`, from the model's checks and the CoA's results."""
    supplier_results = {t["test"]: _supplier_result(t) for t in coa_tests}
    test_checks, issues = [], []
    for plant_test in plant_tests:
        name = plant_test["test"]
        check = checks.get(name) or TestCheck(test=name, verdict="review", reason="The model returned no verdict for this test.")
        details = {"supplier_result": supplier_results.get(name), "plant_requirement": _plant_requirement(plant_test)}
        test_checks.append({**check.model_dump(), **details})
        if check.verdict != "pass":
            kind, severity = VERDICT_ISSUE[check.verdict]
            issues.append(_issue(kind=kind, severity=severity, message=check.reason, test=name, **details))
    return test_checks, issues


@tool
def compare_specs(state: State, tool_call_id: CallId) -> Command:
    """Compare each CoA result with the plant requirements and record a verdict (pass, fail or review) for every required test.

    Needs the plant specification: call it only after load_plant_spec found one. A check the model flagged as unsure is not final:
    when it reports flagged tests, call check_memory next, then resolve_questions.
    """
    _need(state, "plant_spec", "load_plant_spec")
    _status("Comparing results with the specification")
    plant_tests = state["plant_spec"]["tests"]
    coa_tests = _coa_tests(state["tests"])

    checks, usage = _judge(plant_tests, coa_tests)
    test_checks, issues = _verdicts(plant_tests, checks, coa_tests)
    questions = [  # a flag on any verdict, a pass included, sends the check to a person
        {
            "test": c["test"],
            "reason": c["unsure_reason"] or c["reason"],  # a flag without its own reason: the check's
            "supplier_result": c["supplier_result"],
            "plant_requirement": c["plant_requirement"],
        }
        for c in test_checks
        if c["unsure"]
    ]
    content = f"Verdicts: {_json(_counts(test_checks))}. Issues raised: {len(issues)}."
    if questions:
        content += f" Flagged unsure, for a person to review: {len(questions)}. Call check_memory, then resolve_questions."
    update = {**usage, "test_checks": test_checks, "issues": issues, "open_questions": questions}
    return _reply(update, tool_call_id, "compare_specs", content)


@tool
def check_memory(state: State, tool_call_id: CallId) -> Command:
    """Look in the memory of earlier answers for what a person answered when a check like each flagged one came up.

    Call it once, right after compare_specs, and only when compare_specs reported flagged tests. What it finds is shown to the person
    that resolve_questions asks, who decides; a memory that cannot be read finds nothing and never stops the run.
    """
    _need(state, "open_questions", "compare_specs")
    questions = state["open_questions"]
    if not questions:
        return _reply({}, tool_call_id, "check_memory", "No check is flagged as unsure: nothing to look up.")
    _status("Looking for earlier answers")
    product_code = state.get("supplier_materials", {}).get("product_code")
    try:
        asked = [{**q, "precedents": memory.find_precedents(q, product_code)} for q in questions]  # a question has them once looked up
    except Exception as error:
        logger.warning("the memory was not read: %s: %s", type(error).__name__, error)
        asked = [{**q, "precedents": []} for q in questions]
    content = (
        f"Earlier answers found for {sum(bool(q['precedents']) for q in asked)} of {len(asked)} flagged check(s). Call resolve_questions."
    )
    return _reply({"open_questions": asked}, tool_call_id, "check_memory", content)


@tool
def resolve_questions(state: State, tool_call_id: CallId) -> Command:
    """Ask a person to review the checks compare_specs flagged as unsure (e.g. a result in another unit) and wait for their answers.

    Call it once, right after check_memory, and only when compare_specs reported flagged tests. The run pauses until a person
    answers; the tests they answered are then judged again with the answer.
    """
    _need(state, "open_questions", "compare_specs")
    questions = state["open_questions"]
    if not questions:
        return _reply({}, tool_call_id, "resolve_questions", "No check is flagged as unsure.")
    if any("precedents" not in q for q in questions):
        raise OutOfOrder("The memory is not checked yet: call check_memory first.")
    # the first thing the tool does: a resumed run starts the tool over, and nothing before this line may cost a model call
    reply = interrupt({"questions": questions})  # a person's reply: {"answers": {test: text}, "by": who, "remember": {test: scope}}
    answers, by = {test: text.strip() for test, text in reply["answers"].items() if text.strip()}, reply.get("by")
    _status("Applying the answers")
    answered = [q for q in questions if q["test"] in answers]  # a check left unanswered keeps the model's verdict
    if not answered:
        return _reply({"open_questions": []}, tool_call_id, "resolve_questions", "No flagged check was answered: the verdicts stay.")

    names = {q["test"] for q in answered}
    plant_tests = [t for t in state["plant_spec"]["tests"] if t["test"] in names]
    coa_tests = _coa_tests(state["tests"], names)
    scopes = reply.get("remember") or {}  # test -> who the answer is kept for; a test left out gets the default
    clarifications = [
        {
            "test": q["test"],
            "reason": q["reason"],
            "answer": answers[q["test"]],
            "by": by,
            "scope": scopes.get(q["test"], DEFAULT_SCOPE),  # the API takes only the known scopes
        }
        for q in answered
    ]
    extra = "\n\nA person responsible for quality reviewed the points you were unsure about. Their answers are authoritative:\n" + _json(
        [{k: c[k] for k in ("test", "reason", "answer")} for c in clarifications]
    )
    checks, usage = _judge(plant_tests, coa_tests, extra)
    rechecked, new_issues = _verdicts(plant_tests, checks, coa_tests)
    by_test = {c["test"]: {**c, "unsure": False, "unsure_reason": None} for c in rechecked}  # a person's answer is final: not asked again
    test_checks = [by_test.get(c["test"], c) for c in state["test_checks"]]
    issues = [i for i in state.get("issues", []) if i.get("test") not in names] + new_issues
    update = {
        **usage,
        "test_checks": test_checks,
        "issues": issues,
        "open_questions": [],
        "clarifications": [*state.get("clarifications", []), *clarifications],
    }
    content = f"Answered: {len(answered)}. Verdicts now: {_json(_counts(test_checks))}. Issues: {len(issues)}."
    return _reply(update, tool_call_id, "resolve_questions", content)


def _note_input(clarification: dict, check: dict) -> dict:
    """What the model sees of an answer: the check it is about, and the answer."""
    figures = {k: check.get(k) for k in ("supplier_result", "plant_requirement")}
    return {**{k: clarification[k] for k in ("test", "reason", "answer")}, **figures}


@tool
def remember_clarifications(state: State, tool_call_id: CallId) -> Command:
    """Keep what a person answered about the flagged checks, with a summary and a topic, so that a later review of the same kind can use it.

    Call it once, after resolve_questions, and only when a person answered. An answer given for this lot only is not kept. A failure
    to remember never stops the run.
    """
    _not_waiting(state)
    if state.get("memory_saved"):
        return _reply({}, tool_call_id, "remember_clarifications", "Already kept.")
    kept = [c for c in state.get("clarifications", []) if c["scope"] != "none"]
    if not kept:
        return _reply(
            {"memory_saved": True}, tool_call_id, "remember_clarifications", "Nothing to keep: no answer was given for later reviews."
        )
    _status("Remembering the answers")
    checks = {c["test"]: c for c in state.get("test_checks", [])}
    usage, notes = NO_USAGE, {}
    try:  # one call for all the answers; without it the answers are kept without a summary and a topic
        result, usage = _ask_structured(ClarificationNotes, NOTES_PROMPT + _json([_note_input(c, checks.get(c["test"], {})) for c in kept]))
        notes = {n.test: n for n in result.notes}
    except Exception as error:
        logger.warning("the answers were not summarized: %s: %s", type(error).__name__, error)
    try:
        memory.keep(kept, state.get("supplier_materials", {}), state["job_id"], notes)
        content = f"Kept {len(kept)} answer(s)."
    except Exception as error:  # the memory never fails the job
        logger.warning("the answers were not saved: %s: %s", type(error).__name__, error)
        content = f"not kept: {type(error).__name__}: {error}"
    clarifications = [  # what the report shows of an answer that was kept
        {**c, "summary": note.summary, "topic": note.topic} if (note := notes.get(c["test"])) else c for c in state["clarifications"]
    ]
    return _reply({**usage, "clarifications": clarifications, "memory_saved": True}, tool_call_id, "remember_clarifications", content)


@tool
def write_summary(state: State, tool_call_id: CallId) -> Command:
    """Work out the outcome (Conforming, Needs review or Non-conforming) from the findings so far.

    Call it when the checks are done, or when a missing specification means there is nothing to compare. render_ui builds the
    report from the findings. It waits for the checks flagged as unsure to be reviewed: call resolve_questions first when
    compare_specs reported any, and remember_clarifications when a person answered.
    """
    _not_waiting(state)
    if state.get("clarifications") and not state.get("memory_saved"):
        raise OutOfOrder("A person's answers are not kept yet: call remember_clarifications first.")
    _status("Summarizing the findings")
    summary = _summary(state)
    result = _result(summary["outcome"], state.get("test_checks", []), summary["header"])
    content = f"Outcome: {summary['outcome']}. Verdicts: {_json(summary['counts'])}. Issues: {len(summary['issues'])}."
    return _reply({"result": result}, tool_call_id, "write_summary", content)


@tool
def render_ui(state: State, tool_call_id: CallId) -> Command:
    """Build the report page from the findings. This is the last step; call write_summary first, unless the document is not a CoA."""
    _status("Building the report")
    if rejection := next((i for i in state.get("issues", []) if i["kind"] == "not_a_coa"), None):
        spec = _alert_spec("This document is not a Certificate of Analysis", rejection["message"])
        update = {"ui_spec": spec, "result": _result(NOT_A_COA, [], {})}
        return _reply(update, tool_call_id, "render_ui", f"The report is built. Outcome: {NOT_A_COA}.")

    _need(state, "result", "write_summary")
    prompt = f"{RENDER_UI_PROMPT}\n{_json(_summary(state))}"
    feedback = ""
    usage = NO_USAGE
    spec = FALLBACK_UI_SPEC
    for _ in range(2):  # one retry, telling the model what was wrong
        reply = get_llm().invoke(prompt + feedback)
        usage = _sum_usage(usage, call_usage(reply))
        try:
            parsed = parse_json_markdown(reply.content)
        except ValueError as error:
            feedback = f"\n\nYour previous reply was not valid JSON ({error}). Reply with only the JSON object."
            continue
        if isinstance(parsed, dict) and isinstance(parsed.get("elements"), dict) and parsed.get("root") in parsed["elements"]:
            spec = parsed
            break
        feedback = '\n\nYour previous reply was not a spec with a "root" key that exists in "elements". Reply with only the JSON object.'
    content = f"The report is built. Outcome: {state['result']['outcome']}."
    return _reply({**usage, "ui_spec": spec}, tool_call_id, "render_ui", content)


@tool
def notify_quality_team(state: State, tool_call_id: CallId) -> Command:
    """Email the plant's quality team about a non-conforming lot: its product, lot, supplier, test counts and a link to the job.

    Call it once, after render_ui, and only when the outcome is Non-conforming: for any other outcome nothing is sent.
    """
    _need(state, "result", "write_summary")
    outcome = state["result"]["outcome"]
    if outcome != NON_CONFORMING:
        return _reply(
            {}, tool_call_id, "notify_quality_team", f"Nothing sent: the outcome is {outcome}, only a {NON_CONFORMING} lot is mailed."
        )
    _status("Sending the alert")
    subject, body = notify.non_conforming_message(state.get("filename") or "The certificate", state.get("job_id"), state["result"])
    try:
        content = send_email.invoke({"subject": subject, "body": body})
    except Exception as error:  # a mail never fails the job
        logger.warning("the non-conforming mail was not sent: %s: %s", type(error).__name__, error)
        content = f"not sent: {type(error).__name__}: {error}"
    return _reply({}, tool_call_id, "notify_quality_team", content)


tools = [
    load_document,
    validate_document,
    get_document_data,
    load_plant_spec,
    compare_specs,
    check_memory,
    resolve_questions,
    remember_clarifications,
    write_summary,
    render_ui,
    notify_quality_team,
]


def agent_model():
    """The chat model with the tools bound (get_material is not one: load_plant_spec runs it)."""
    return get_llm().bind_tools(tools)
