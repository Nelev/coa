from types import SimpleNamespace

import pytest
from pydantic import BaseModel

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
