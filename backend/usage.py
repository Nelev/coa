from langchain_core.callbacks import BaseCallbackHandler
from langchain_core.outputs import LLMResult

from jobs import Jobs


class UsageRecorder(BaseCallbackHandler):
    """Adds what each model call of a job's run used to the job; pass it in the run's `callbacks`.

    The tokens come from the message's usage metadata (output tokens include the model's reasoning). The cost is what OpenRouter
    charged for the call, from its raw usage; it is None when the provider does not say.
    """

    def __init__(self, store: Jobs, job_id: str):
        self.store, self.job_id = store, job_id

    def on_llm_end(self, response: LLMResult, **_kwargs) -> None:
        usage = response.generations[0][0].message.usage_metadata  # a chat model call has one generation
        if usage:
            cost = ((response.llm_output or {}).get("token_usage") or {}).get("cost")
            self.store.add_usage(self.job_id, usage["input_tokens"], usage["output_tokens"], cost)
