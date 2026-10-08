import os
from functools import lru_cache

from langchain_openai import ChatOpenAI
from langgraph.graph import END, START, StateGraph
from pydantic import BaseModel
from pypdf import PdfReader

from .state import AgentState


class Material(BaseModel):
    name: str
    value: str


class MaterialList(BaseModel):
    materials: list[Material]


@lru_cache
def get_llm() -> ChatOpenAI:
    return ChatOpenAI(
        model="openai/gpt-5-mini",
        api_key=os.environ["OPENROUTER_API_KEY"],
        base_url="https://openrouter.ai/api/v1",
    )


def load_document(state: AgentState) -> dict:
    """Extract the text of the PDF at `document_path`."""
    reader = PdfReader(state["document_path"])
    text = "\n".join(page.extract_text() or "" for page in reader.pages)
    return {"document_text": text}


def get_document_data(state: AgentState) -> dict:
    """Parse the document text and return the materials and their values."""
    prompt = (
        "Parse the following document and return a list of materials and their values.\n\n"
        f"Document: {state['document_text']}\n\n"
    )
    result = get_llm().with_structured_output(MaterialList).invoke(prompt)

    return {"supplier_materials": {m.name: m.value for m in result.materials}}


graph = StateGraph(AgentState)

graph.add_node("load_document", load_document)
graph.add_node("get_document_data", get_document_data)
graph.add_edge(START, "load_document")
graph.add_edge("load_document", "get_document_data")
graph.add_edge("get_document_data", END)

app = graph.compile()
