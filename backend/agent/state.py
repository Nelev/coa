from typing import Annotated, TypedDict

from langchain_core.messages import AnyMessage
from langgraph.graph.message import add_messages


class AgentState(TypedDict):
    """
    Represents the state of the agent.
    """

    messages: Annotated[list[AnyMessage], add_messages]
    document_path: str
    document_text: str
    supplier_materials: dict[str, str]  # CoA header: product, lot, dates, PO, ...
    spec_values: dict[str, str]  # test name -> specification limit
    tests: list[dict]  # structured CoA rows: test, result, unit, specification, method, status
    plant_spec: dict  # plant requirements for the CoA's product code
    test_checks: list[dict]  # one verdict per plant-required test, with supplier_result and plant_requirement
    ui_spec: dict  # json-render spec of the report page, rendered by the frontend
    result: dict  # what the job list shows: outcome, verdict counts, product, lot and supplier
    is_running: bool
    is_paused: bool
    issues: list[dict]  # non-passing checks and missing-spec problems, see schema.Issue
    report: str
