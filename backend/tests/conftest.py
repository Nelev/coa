import os
import uuid

import psycopg
import pytest
from langchain_core.messages import AIMessage
from langgraph.config import get_stream_writer as real_stream_writer
from psycopg.sql import SQL, Identifier
from pydantic import BaseModel

import auth
import main
import notify
from agent import agent
from jobs import in_schema
from react_agent import tools as react_tools
from schema import schema

AGENT_MODULES = (agent, react_tools)  # the modules that call get_llm and get_stream_writer
CALL_USAGE = {"cost": 0.001, "input_tokens": 10, "output_tokens": 5}  # what every fake model call reports


def reply(content="", tool_calls=()):
    """A chat reply (calling the given tools) carrying the usage and the OpenRouter cost of CALL_USAGE."""
    usage = {"input_tokens": CALL_USAGE["input_tokens"], "output_tokens": CALL_USAGE["output_tokens"], "total_tokens": 0}
    return AIMessage(
        content, tool_calls=list(tool_calls), usage_metadata=usage, response_metadata={"token_usage": {"cost": CALL_USAGE["cost"]}}
    )


def call(name, **args):
    """What the ReAct agent's model answers when it picks a tool."""
    return reply(tool_calls=[{"name": name, "args": args, "id": f"call_{name}", "type": "tool_call"}])


class FakeLLM:
    """Stands in for get_llm(): returns the queued responses, one per invoke, and records the prompts."""

    def __init__(self, *responses):
        self.responses = list(responses)
        self.prompts = []

    @property
    def calls(self):
        return len(self.prompts)

    def with_structured_output(self, _schema, include_raw=False):
        assert include_raw, "the agent reads the call's usage from the raw message"
        return _Structured(self)

    def bind_tools(self, _tools):
        return self

    def invoke(self, prompt):
        self.prompts.append(prompt)
        response = self.responses.pop(0)
        if isinstance(response, list):  # a list of checks is a comparison result
            return schema.ComparisonResult(checks=response)
        # a model instance is a structured result, a message is returned as it is; a string is a raw chat reply
        return response if isinstance(response, (BaseModel, AIMessage)) else reply(response)


class _Structured:
    def __init__(self, llm):
        self.llm = llm

    def invoke(self, prompt):
        return {"raw": reply(), "parsed": self.llm.invoke(prompt), "parsing_error": None}


@pytest.fixture
def fake_llm(monkeypatch):
    def install(*responses):
        llm = FakeLLM(*responses)
        for module in AGENT_MODULES:
            monkeypatch.setattr(module, "get_llm", lambda: llm)
        return llm

    return install


@pytest.fixture(autouse=True)
def stream_writer_outside_a_graph(monkeypatch):
    """The nodes report their status with get_stream_writer(), which only works inside a graph run: elsewhere it is a no-op."""

    def get_stream_writer():
        try:
            return real_stream_writer()
        except RuntimeError:
            return lambda _: None

    for module in AGENT_MODULES:
        monkeypatch.setattr(module, "get_stream_writer", get_stream_writer)


@pytest.fixture
def signed_in(monkeypatch):
    """Lets the API tests act as a signed-in person; test_auth.py checks the sign-in itself."""
    monkeypatch.setitem(main.app.dependency_overrides, auth.require_user, lambda: {"sub": "user_test"})


@pytest.fixture(autouse=True)
def no_real_mail(monkeypatch):
    """agent.py loads backend/.env, which may hold real SMTP settings: a test that finishes a non-conforming job must not mail anyone."""
    for name in ("SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASSWORD", "SMTP_FROM", "NOTIFY_EMAIL", "APP_URL"):
        monkeypatch.delenv(name, raising=False)


@pytest.fixture
def mails(monkeypatch):
    """The (subject, body) of every mail the run sends; nothing leaves the machine."""
    sent = []
    monkeypatch.setattr(notify, "send_mail", lambda subject, body: sent.append((subject, body)) or True)
    return sent


@pytest.fixture
def database(monkeypatch):
    """A database of its own for the test: a schema for the jobs tables and one for the agent's checkpoints, dropped afterwards. It
    yields the name of the jobs schema.

    Needs a Postgres with pgvector: TEST_DATABASE_URL, by default the one `docker compose up -d db` starts. DATABASE_URL (the real one,
    which backend/.env may hold) is never used here.
    """
    base = os.getenv("TEST_DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/coa")
    name = f"test_{uuid.uuid4().hex[:12]}"
    checkpoints = f"{name}_checkpoints"  # made by open_checkpointer
    with psycopg.connect(base, autocommit=True) as admin:
        admin.execute(SQL("CREATE SCHEMA {}").format(Identifier(name)))
    monkeypatch.setenv("DATABASE_URL", in_schema(base, name))
    monkeypatch.setenv("CHECKPOINT_SCHEMA", checkpoints)
    yield name
    with psycopg.connect(base, autocommit=True) as admin:
        for dropped in (name, checkpoints):
            admin.execute(SQL("DROP SCHEMA IF EXISTS {} CASCADE").format(Identifier(dropped)))
