"""The agent's memory of what people answered about a check it was unsure of: a LangChain vector store (PGVector, in langchain-postgres).

An answer is a Document. Its text is what is embedded: the test, why the agent was unsure, the answer and the summary of it, so a check
flagged later is found by what it looks like. Its metadata holds the rest, and what to filter by: the `scope` (`product`: the lots of one
product; `global`: every product), the `product_code` and the `test`. The vector store's tables sit in the schema of the checkpoints.
"""

import os
from functools import lru_cache

import psycopg
from dotenv import load_dotenv
from langchain_core.documents import Document
from langchain_openai import OpenAIEmbeddings
from langchain_postgres import PGVector
from sqlalchemy import create_engine
from sqlalchemy.pool import NullPool

from jobs import in_schema, langgraph_schema, now_ms

load_dotenv()

EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL") or "openai/text-embedding-3-small"
# the least similarity (0 to 1) for an earlier answer to be offered. With text-embedding-3-small the same situation in other words scores
# about 0.86 and an unrelated check of the same test 0.72, so 0.8; another embedding model needs its own value.
MIN_SCORE = float(os.getenv("MEMORY_MIN_SCORE") or 0.8)
MAX_PRECEDENTS = 3  # how many earlier answers are offered for one check

COLLECTION = "clarifications"


@lru_cache
def get_embedder() -> OpenAIEmbeddings:
    return OpenAIEmbeddings(
        model=EMBEDDING_MODEL,
        api_key=os.environ["OPENROUTER_API_KEY"],
        base_url="https://openrouter.ai/api/v1",
        check_embedding_ctx_length=False,  # the length check sends token ids, which OpenRouter's other providers do not take
    )


@lru_cache
def _build(dsn: str) -> PGVector:
    """The vector store in the agent's schema, with its tables made when missing (the vector extension is made by the first migration).

    The connection's search_path also holds `public`, where that extension is: the embedding column needs its type.
    """
    conninfo = in_schema(dsn, langgraph_schema(dsn), "public")
    engine = create_engine("postgresql+psycopg://", creator=lambda: psycopg.connect(conninfo), poolclass=NullPool)
    return PGVector(embeddings=get_embedder(), collection_name=COLLECTION, connection=engine, use_jsonb=True, create_extension=False)


def vector_store() -> PGVector:
    """The memory's vector store, in the database of DATABASE_URL. The first call makes its tables: the API makes it when it starts."""
    return _build(os.environ["DATABASE_URL"])


def embedding_text(value: dict) -> str:
    """What is embedded for an answer: the situation and what was decided about it."""
    lines = [f"Test: {value['test']}", f"Situation: {value['reason']}", f"Answer: {value['answer']}"]
    if value.get("summary"):
        lines.append(f"Summary: {value['summary']}")
    return "\n".join(lines)


def keep(clarifications: list[dict], header: dict, run_id: str, notes: dict) -> None:
    """Add the answers to the memory (the caller leaves out those for one lot only). `header` is the
    certificate's, `run_id` the run's, `notes` the model's summary and topic by test name (a test without one is
    kept without).

    A document has the id of its run and test, so keeping the same answer again replaces it. They are embedded in one request.
    """
    documents = []
    for c in clarifications:
        note = notes.get(c["test"])
        value = {
            "test": c["test"],
            "reason": c["reason"],
            "answer": c["answer"],
            "summary": note.summary if note else None,
            "topic": note.topic if note else None,
            "scope": c["scope"],
            "product_code": header.get("product_code"),
            "lot": header.get("lot_number"),
            "run_id": run_id,
            "answered_by": c.get("by"),
            "answered_at": now_ms(),
        }
        documents.append(Document(id=f"{run_id}:{c['test']}", page_content=embedding_text(value), metadata=value))
    vector_store().add_documents(documents)  # their ids are the ones the documents carry


def find_precedents(question: dict, product_code: str | None) -> list[dict]:
    """The answers kept earlier to checks like `question` (a flagged check: test, reason, ...), the most similar first: those for the
    same test of the same product, and those for every product. Only the similar enough are returned."""
    everywhere = {"scope": "global"}
    here = {"$and": [{"scope": "product"}, {"product_code": product_code}, {"test": question["test"]}]}
    hits = vector_store().similarity_search_with_relevance_scores(
        f"Test: {question['test']}\nSituation: {question['reason']}",
        k=MAX_PRECEDENTS,
        filter={"$or": [here, everywhere]} if product_code else everywhere,  # an answer for the product's lots needs to know the product
        score_threshold=MIN_SCORE,
    )
    return [
        {
            "id": doc.id,  # of the run and the test: unique, for a list key
            "answer": doc.metadata["answer"],
            "summary": doc.metadata.get("summary"),
            "by": doc.metadata.get("answered_by"),
            "at": doc.metadata["answered_at"],
            "run_id": doc.metadata["run_id"],
            "lot": doc.metadata.get("lot"),
            "match": "same_product" if doc.metadata["scope"] == "product" else "similar",
        }
        for doc, _score in hits
    ]
