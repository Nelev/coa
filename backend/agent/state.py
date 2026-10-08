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
    test_results: dict[str, str]  # test name -> reported result (with unit)
    is_running: bool
    is_paused: bool
    issues: list[str]
    report: str
