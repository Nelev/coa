"""Run the ReAct agent on every scenario with the real model (OPENROUTER_API_KEY; about two cents a run) and score it.

Run from backend/ (needs requirements-eval.txt):
    .venv/bin/python -m evals.run

ragas stores the rows of the run in evals/results/experiments/<time>.csv; the scores are also written to evals/results/<time>.xlsx.
Nothing leaves the machine but the model calls: the mail and the memory of earlier answers are stubbed, and the traces (LangSmith)
and ragas' usage statistics are off.
"""

import asyncio
import os
from dataclasses import asdict
from datetime import datetime
from pathlib import Path

os.environ["LANGSMITH_TRACING"] = "false"  # before langchain is imported: backend/.env sets it, and load_dotenv keeps what is set
os.environ["LANGCHAIN_TRACING_V2"] = "false"
os.environ["RAGAS_DO_NOT_TRACK"] = "true"  # ragas sends usage statistics to its authors unless told not to

import pandas as pd  # noqa: E402
from langchain_core.messages import ToolMessage  # noqa: E402
from langgraph.checkpoint.memory import MemorySaver  # noqa: E402
from langgraph.types import Command  # noqa: E402
from ragas import Dataset, experiment  # noqa: E402

import notify  # noqa: E402
from react_agent import memory  # noqa: E402
from react_agent.react_agent import graph  # noqa: E402

from .metrics import mail_correct, outcome_correct, tools_correct, verdict_accuracy  # noqa: E402
from .scenarios import SCENARIOS  # noqa: E402

RESULTS = Path(__file__).resolve().parent / "results"
REPEATS = 1  # the model's answers vary: more than one run of each scenario shows how much

for setting in ("SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASSWORD", "SMTP_FROM", "NOTIFY_EMAIL", "APP_URL"):
    os.environ.pop(setting, None)  # backend/.env may hold real mail settings
notify.send_mail = lambda *args, **kwargs: True  # the tool then answers "sent", which the mail metric reads
memory.find_precedents = lambda *args, **kwargs: []
memory.keep = lambda *args, **kwargs: None


def run_agent(row: dict) -> tuple[dict, str | None]:
    """Run the agent on the row's PDF, answering what it asks as the API would: the final state, and the error if it stopped on one."""
    agent = graph.compile(checkpointer=MemorySaver())  # a run needs a checkpointer to pause
    config = {"configurable": {"thread_id": row["id"]}, "recursion_limit": 40}  # 40: the limit main.py sets for the API
    error = None
    try:
        out = agent.invoke({"document_path": row["path"], "filename": Path(row["path"]).name, "job_id": row["id"]}, config)
        if "__interrupt__" in out:  # the agent asks once: the answers clear every question
            asked = [q["test"] for q in out["__interrupt__"][0].value["questions"]]
            answers = {test: row["answers"][test] for test in asked if test in row["answers"]}  # the rest stay unanswered
            agent.invoke(Command(resume={"answers": answers, "by": "evaluation", "remember": {}}), config)
    except Exception as e:  # a failed run is a result of the evaluation, not a crash of it
        error = f"{type(e).__name__}: {e}"
    return agent.get_state(config).values, error


@experiment()
async def run_experiment(row):
    state, error = await asyncio.to_thread(run_agent, row)
    messages = state.get("messages", [])
    outcome = state.get("result", {}).get("outcome")
    verdicts = {c["test"]: c["verdict"] for c in state.get("test_checks", [])}
    tools = [call["name"] for m in messages if m.type == "ai" for call in m.tool_calls]
    mailed = any(isinstance(m, ToolMessage) and m.name == "notify_quality_team" and m.content == "sent" for m in messages)

    outcome_score = await outcome_correct.ascore(prediction=outcome, expected=row["outcome"])
    verdict_score = await verdict_accuracy.ascore(prediction=verdicts, expected=row["verdicts"])
    mail_score = await mail_correct.ascore(prediction=mailed, expected=row["mails"])
    tools_score = await tools_correct.ascore(prediction=tools, expected=row["tools"])

    return {
        "scenario": row["id"],
        "outcome": outcome,
        "tools": " > ".join(tools),
        "outcome_correct": outcome_score.value,
        "verdict_accuracy": verdict_score.value,
        "verdicts_reason": verdict_score.reason,
        "mail_correct": mail_score.value,
        "tools_correct": tools_score.value,
        "cost_usd": state.get("cost", 0.0),
        "error": error,
    }


async def main():
    name = f"{datetime.now():%Y%m%d-%H%M%S}"
    rows = [{**asdict(s), "path": str(s.path)} for s in SCENARIOS] * REPEATS
    dataset = Dataset(name="scenarios", backend="local/csv", root_dir=str(RESULTS), data=rows)
    runs = (await run_experiment.arun(dataset, name=name)).to_pandas()

    with pd.ExcelWriter(RESULTS / f"{name}.xlsx") as writer:
        runs.groupby("scenario", sort=False).mean(numeric_only=True).round(3).to_excel(writer, sheet_name="Summary")
        runs.to_excel(writer, sheet_name="Runs", index=False)
    print(runs.drop(columns=["tools", "verdicts_reason", "error"]).round(3).to_string(index=False))
    print(f"Total cost: ${runs['cost_usd'].sum():.3f}. Scores in {RESULTS / name}.xlsx")


if __name__ == "__main__":
    asyncio.run(main())
