import os
from functools import lru_cache

from dotenv import load_dotenv
from langchain_openai import ChatOpenAI
from langgraph.graph import END, START, StateGraph
from pypdf import PdfReader

from .schema import CoAData
from .state import AgentState

load_dotenv()


EXTRACTION_PROMPT = (
    "You are reading a supplier Certificate of Analysis (CoA). Extract its data exactly as written.\n"
    "- Copy values verbatim; never infer, correct, convert or round them.\n"
    "- Use null for anything the document does not state.\n"
    "- Every row of the analytical results table is one test; do not mix header fields into the tests.\n\n"
    "Document:\n"
)


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
    """Extract the CoA header, specifications and reported results from the document text."""
    coa = get_llm().with_structured_output(CoAData).invoke(EXTRACTION_PROMPT + state["document_text"])

    return {
        "supplier_materials": {k: v for k, v in coa.header.model_dump().items() if v is not None},
        "spec_values": {t.test: t.specification for t in coa.tests if t.specification},
        "test_results": {t.test: f"{t.result} {t.unit}" if t.unit else t.result for t in coa.tests},
    }


graph = StateGraph(AgentState)

graph.add_node("load_document", load_document)
graph.add_node("get_document_data", get_document_data)
graph.add_edge(START, "load_document")
graph.add_edge("load_document", "get_document_data")
graph.add_edge("get_document_data", END)

app = graph.compile()


if __name__ == "__main__":
    import sys
    from pathlib import Path

    default_doc = Path(__file__).resolve().parent.parent / "docs" / "sample_coa_citric_acid.pdf"
    result = app.invoke({"document_path": sys.argv[1] if len(sys.argv) > 1 else str(default_doc)})

    print("== Header ==")
    for key, value in result["supplier_materials"].items():
        print(f"{key}: {value}")
    print("\n== Tests (result | specification) ==")
    for test, value in result["test_results"].items():
        print(f"{test}: {value} | {result['spec_values'].get(test, '-')}")
