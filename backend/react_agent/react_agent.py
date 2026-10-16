"""The CoA check as a ReAct agent: two nodes, `agent` (the model, with the tools bound) and `tools` (runs the tools it called).

The model picks the next step from what each tool answered, instead of the fixed edges of agent/agent.py. The steps are the tools of
react_agent/tools.py; they keep their data in the state, so the model only reads short answers.
"""

from langchain_core.messages import HumanMessage, SystemMessage
from langgraph.graph import END, START, StateGraph
from langgraph.prebuilt import ToolNode
from langgraph.prebuilt.tool_node import ToolInvocationError

from .prompts import SYSTEM_PROMPT
from .state import AgentState
from .tools import OutOfOrder, agent_model, call_usage, tools


def agent(state: AgentState) -> dict:
    """Ask the model for the next step: a tool call, or the final answer."""
    history = state.get("messages", [])
    filename, job_id = state.get("filename") or "uploaded", state.get("job_id") or "unknown"
    task = [] if history else [HumanMessage(f"Check the certificate in the file {filename} (job id {job_id}).")]
    response = agent_model().invoke([SystemMessage(SYSTEM_PROMPT), *task, *history])
    return {**call_usage(response), "messages": [*task, response]}  # the first call also puts the task in the state


def should_continue(state: AgentState) -> str:
    """Run the tools the model called; with none, its answer is final."""
    return "tools" if state["messages"][-1].tool_calls else END


# A tool called too early, or with arguments it cannot take, is told to the model; any other failure (the ERP down, a bad model reply)
# fails the run instead of reading as an answer.
tool_node = ToolNode(tools, handle_tool_errors=(OutOfOrder, ToolInvocationError))

graph = StateGraph(AgentState)
graph.add_node("agent", agent)
graph.add_node("tools", tool_node)
graph.add_edge(START, "agent")
graph.add_conditional_edges("agent", should_continue, ["tools", END])
graph.add_edge("tools", "agent")

app = graph.compile()
