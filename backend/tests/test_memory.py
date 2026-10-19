import os

import pytest

import memory
from jobs import Jobs
from tests.conftest import connect

CLARIFICATION = {"test": "Lead", "reason": "The unit is ppb.", "answer": "It is ppm.", "by": "QA Anna", "scope": "product"}
HEADER = {"product_code": "CA-ANH-25", "supplier": "Acme", "lot_number": "L1"}
RUN = "run1"
QUESTION = {"test": "Lead", "reason": "The unit is ppb."}


@pytest.fixture(autouse=True)
def memory_database(tmp_path, database):
    """The test's database, made as the app makes it: the first migration installs the vector extension."""
    Jobs(tmp_path)
    memory.vector_store()  # the app makes the tables when it starts


def keep(*clarifications, header=HEADER, run=RUN):
    memory.keep(list(clarifications), header, run, {})


def test_what_is_embedded_is_the_situation_the_answer_and_its_summary():
    value = {"test": "Lead", "reason": "ppb?", "answer": "ppm.", "summary": "ppb is ppm."}
    assert memory.embedding_text(value) == "Test: Lead\nSituation: ppb?\nAnswer: ppm.\nSummary: ppb is ppm."
    assert "Summary" not in memory.embedding_text({**value, "summary": None})


def test_a_kept_answer_is_found_for_a_check_like_it():
    keep(CLARIFICATION)
    (found,) = memory.find_precedents(QUESTION, "CA-ANH-25")
    assert (found["id"], found["answer"], found["by"], found["run_id"], found["lot"], found["match"]) == (
        "run1:Lead",
        "It is ppm.",
        "QA Anna",
        "run1",
        "L1",
        "same_product",
    )


def test_the_closest_answers_come_first_and_at_most_three_are_offered():
    for i in range(5):
        keep({**CLARIFICATION, "answer": f"Answer {i}"}, run=f"run{i}")
    keep({**CLARIFICATION, "reason": "Something else about moisture.", "answer": "Far"}, run="far")
    found = memory.find_precedents(QUESTION, "CA-ANH-25")
    assert len(found) == memory.MAX_PRECEDENTS and "Far" not in [f["answer"] for f in found]


def test_an_answer_for_another_product_or_test_is_not_offered():
    keep(CLARIFICATION, header={**HEADER, "product_code": "OTHER-1"}, run="other")
    keep({**CLARIFICATION, "test": "Arsenic"}, run="arsenic")
    assert memory.find_precedents(QUESTION, "CA-ANH-25") == []


def test_an_answer_for_every_product_is_found_for_any_product_and_for_none():
    keep({**CLARIFICATION, "scope": "global"})
    assert [f["match"] for f in memory.find_precedents(QUESTION, "OTHER-1")] == ["similar"]
    assert [f["match"] for f in memory.find_precedents(QUESTION, None)] == ["similar"]  # an answer for a product's lots needs a product


def test_the_threshold_decides_what_is_similar_enough(monkeypatch):
    keep(CLARIFICATION)
    monkeypatch.setattr(memory, "MIN_SCORE", 1.1)  # more than the best possible
    assert memory.find_precedents(QUESTION, "CA-ANH-25") == []


def test_keeping_the_same_answer_again_replaces_it():
    for answer in ("First.", "Second."):
        keep({**CLARIFICATION, "answer": answer})
    assert [f["answer"] for f in memory.find_precedents(QUESTION, "CA-ANH-25")] == ["Second."]


def test_the_vector_store_lives_in_the_schema_of_the_checkpoints_with_its_vectors():
    keep(CLARIFICATION)
    schema = os.environ["CHECKPOINT_SCHEMA"]
    with connect() as db:
        tables = {n for (n,) in db.execute("SELECT table_name FROM information_schema.tables WHERE table_schema = %s", (schema,))}
        assert {"langchain_pg_collection", "langchain_pg_embedding"} <= tables
        rows = db.execute(f"SELECT id, embedding IS NOT NULL FROM {schema}.langchain_pg_embedding").fetchall()
    assert rows == [("run1:Lead", True)]
