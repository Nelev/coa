from types import SimpleNamespace

import pytest
from langchain_core.messages import AIMessage
from langchain_core.outputs import ChatGeneration, LLMResult
from pydantic import BaseModel

import auth
import main
from agent import agent
from schema import schema


class FakeLLM:
    """Stands in for get_llm(): returns the queued responses, one per invoke, and records the prompts."""

    def __init__(self, *responses):
        self.responses = list(responses)
        self.prompts = []

    @property
    def calls(self):
        return len(self.prompts)

    def with_structured_output(self, _schema):
        return self

    def invoke(self, prompt):
        self.prompts.append(prompt)
        response = self.responses.pop(0)
        if isinstance(response, list):  # a list of checks is a comparison result
            return schema.ComparisonResult(checks=response)
        # a model instance is a structured result; a string is a raw chat reply
        return response if isinstance(response, BaseModel) else SimpleNamespace(content=response)


@pytest.fixture
def llm_result():
    """Builds what a chat model call ends with, for a callback's `on_llm_end`: tokens, and the cost OpenRouter reports."""

    def build(input_tokens=10, output_tokens=5, cost=0.002, with_usage=True):
        usage = {"input_tokens": input_tokens, "output_tokens": output_tokens, "total_tokens": 0} if with_usage else None
        message = AIMessage("ok", usage_metadata=usage)
        llm_output = {"token_usage": {"cost": cost}} if cost is not None else None  # a provider that does not say what a call cost
        return LLMResult(generations=[[ChatGeneration(message=message)]], llm_output=llm_output)

    return build


@pytest.fixture
def fake_llm(monkeypatch):
    def install(*responses):
        llm = FakeLLM(*responses)
        monkeypatch.setattr(agent, "get_llm", lambda: llm)
        return llm

    return install


@pytest.fixture(autouse=True)
def stream_writer_outside_a_graph(monkeypatch):
    """The nodes report their status with get_stream_writer(), which only works inside a graph run: elsewhere it is a no-op."""
    real = agent.get_stream_writer

    def get_stream_writer():
        try:
            return real()
        except RuntimeError:
            return lambda _: None

    monkeypatch.setattr(agent, "get_stream_writer", get_stream_writer)


@pytest.fixture
def signed_in(monkeypatch):
    """Lets the API tests act as a signed-in person; test_auth.py checks the sign-in itself."""
    monkeypatch.setitem(main.app.dependency_overrides, auth.require_user, lambda: {"sub": "user_test"})


@pytest.fixture(autouse=True)
def no_real_mail(monkeypatch):
    """agent.py loads backend/.env, which may hold real SMTP settings: a test that finishes a non-conforming job must not mail anyone."""
    for name in ("SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASSWORD", "SMTP_FROM", "NOTIFY_EMAIL", "APP_URL"):
        monkeypatch.delenv(name, raising=False)
