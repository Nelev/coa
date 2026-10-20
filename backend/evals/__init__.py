"""Evaluation of the ReAct agent: scenarios.py (what it should do), metrics.py (how a run is scored), run.py (runs them, writes the scores).

ragas 0.4.3 imports langchain_community.chat_models.vertexai and langchain_community.llms.VertexAI, which the langchain 1.x this project
uses no longer has. It only lists them among the models it accepts, so empty stand-ins are enough (before anything imports ragas).
"""

import sys
import types

import langchain_community.llms as llms

try:
    import langchain_community.chat_models.vertexai  # noqa: F401
except ImportError:
    module = types.ModuleType("langchain_community.chat_models.vertexai")
    module.ChatVertexAI = type("ChatVertexAI", (), {})
    sys.modules[module.__name__] = module
if not hasattr(llms, "VertexAI"):
    llms.VertexAI = type("VertexAI", (), {})
