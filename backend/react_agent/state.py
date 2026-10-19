import operator
from typing import Annotated, TypedDict

from langchain_core.messages import AnyMessage
from langgraph.graph.message import add_messages


class AgentState(TypedDict):
    """
    Represents the state of the agent.
    """

    messages: Annotated[list[AnyMessage], add_messages]
    document_path: str
    filename: str  # the uploaded file's name and the job's id: what the mail about a non-conforming lot names
    job_id: str
    document_text: str
    cost: Annotated[float, operator.add]  # USD the model calls charged so far; each node returns its calls' cost to add
    input_tokens: Annotated[int, operator.add]
    output_tokens: Annotated[int, operator.add]  # includes the model's reasoning
    supplier_materials: dict[str, str]  # CoA header: product, lot, dates, PO, ...
    spec_values: dict[str, str]  # test name -> specification limit
    tests: list[dict]  # structured CoA rows: test, result, unit, specification, method, status
    plant_spec: dict  # plant requirements for the CoA's product code
    test_checks: list[dict]  # one verdict per plant-required test, with supplier_result and plant_requirement
    open_questions: list[dict]  # flagged checks awaiting a person: test, reason, supplier_result, plant_requirement, precedents
    clarifications: list[dict]  # what a person answered about the flagged checks: test, reason, answer, by, scope; summary, topic once kept
    memory_saved: bool  # remember_clarifications has run: the answers are in the memory, or there was nothing to keep
    ui_spec: dict  # json-render spec of the report page, rendered by the frontend
    result: dict  # what the job list shows: outcome, verdict counts, product, lot and supplier
    is_running: bool
    is_paused: bool
    issues: list[dict]  # non-passing checks and missing-spec problems, see schema.Issue
    report: str
