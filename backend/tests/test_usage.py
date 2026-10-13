import io

import pytest

from jobs import Jobs
from usage import UsageRecorder


@pytest.fixture
def job(tmp_path):
    store = Jobs(tmp_path)
    return store, store.create("coa.pdf", io.BytesIO(b"%PDF"))


def usage_of(saved):
    return saved["input_tokens"], saved["output_tokens"], saved["cost_usd"]


def used(job, result):
    store, job_id = job
    UsageRecorder(store, job_id).on_llm_end(result)
    return store.get(job_id, with_spec=False)


def test_a_model_call_adds_its_tokens_and_the_cost_openrouter_charged(job, llm_result):
    assert usage_of(used(job, llm_result(10, 5, 0.002))) == (10, 5, 0.002)


def test_a_call_whose_provider_gives_no_cost_leaves_the_cost_unknown(job, llm_result):
    assert usage_of(used(job, llm_result(10, 5, cost=None))) == (10, 5, None)


def test_a_call_without_usage_adds_nothing(job, llm_result):
    assert usage_of(used(job, llm_result(with_usage=False))) == (None, None, None)


def test_usage_adds_up_over_the_model_calls_of_a_job(job):
    store, job_id = job
    store.add_usage(job_id, 100, 20, 0.001)
    store.add_usage(job_id, 50, 5, 0.0005)
    assert usage_of(store.get(job_id, with_spec=False)) == (150, 25, 0.0015)


def test_a_call_without_a_cost_adds_tokens_but_leaves_the_cost_as_it_was(job):
    store, job_id = job
    for cost in (None, 0.01, None):
        store.add_usage(job_id, 10, 1, cost)
    assert usage_of(store.get(job_id)) == (30, 3, 0.01)
