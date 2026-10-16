"""What the agent can do outside the model and the PDF, as LangChain tools: each has a name, a description and an argument schema.

The graph's tool_node runs them (see agent.py): get_material after load_plant_spec, send_email for a non-conforming lot.
The tools only wrap the plant systems, which is where a real ERP or mail service would be connected (see erp.py and notify.py).
"""

from langchain.agents.middleware import wrap_tool_call
from langchain_core.messages import ToolMessage
from langchain_core.tools import tool

import erp
import notify


@wrap_tool_call
def handle_tool_errors(request, handler):
    """Catch and handle tool errors gracefully."""
    tool_name = request.tool_call["name"]

    try:
        print(f"[TOOL] Executing {tool_name}")
        result = handler(request)
        print(f"[TOOL] Success: {tool_name}")
        return result
    except Exception as e:
        print(f"[TOOL] Error in {tool_name}: {str(e)}")
        return ToolMessage(
            content=f"The tool '{tool_name}' encountered an error: {str(e)[:100]}. Please try again or rephrase your request.",
            tool_call_id=request.tool_call["id"],
        )


@tool
def get_material(product_code: str | None) -> dict | None:
    """Look up a material in the plant's ERP by product code.

    Pass the product code exactly as printed on the certificate; never guess or alter it. Returns the material master
    record (name, plant tests, approved suppliers, minimum remaining shelf life in days), or None when the ERP has no such
    product code.
    """
    return erp.get_material(product_code)


@tool
def send_email(subject: str, body: str) -> str:
    """Send a plain-text email to the plant's quality team (NOTIFY_EMAIL).

    Returns "sent", or "not sent: SMTP is not configured" when the mail settings are missing. Raises when the mail server fails.
    """
    return "sent" if notify.send_mail(subject, body) else "not sent: SMTP is not configured"
