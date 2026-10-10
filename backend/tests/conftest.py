from types import SimpleNamespace

import pytest
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
