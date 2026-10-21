"""The constants of the ReAct agent. This module imports nothing from the package, so any of its modules can import it."""

import os

from dotenv import load_dotenv

load_dotenv()  # the settings read from the environment below

# --- limits on the model's work
MAX_PAGES = 30  # a CoA has a few pages; the whole text goes to the model, so a longer document is refused before any call is paid for
VALIDATION_CHARS = 6000  # the start of a document is enough to tell what kind it is
# per model call, reasoning included: a guard against a runaway call; the largest one (the comparison) needs about 5k
MAX_OUTPUT_TOKENS = 12_000
MAX_RUN_OUTPUT_TOKENS = 45_000  # a whole run's output, reasoning included: a clean check uses about 10k, one with a question about 15k

# --- outcomes and issues
NON_CONFORMING = "Non-conforming"
NOT_A_COA = "Not a CoA"

# check verdict -> (issue kind, issue severity); a pass raises no issue
VERDICT_ISSUE = {"fail": ("non_conforming", "critical"), "review": ("needs_review", "warning")}

# what the report shows of an answer; the scope and the rest stay out of the model's input
REPORTED = ("test", "reason", "answer", "by", "summary", "topic")

NO_USAGE = {"cost": 0.0, "input_tokens": 0, "output_tokens": 0}  # also the keys of a usage dict

# a json-render spec holding a single error Alert, for a report the model could not lay out
FALLBACK_UI_SPEC = {
    "root": "alert",
    "elements": {
        "alert": {
            "type": "Alert",
            "props": {
                "title": "The report could not be generated",
                "message": "The model did not return a valid layout. Run the agent again.",
                "type": "error",
            },
            "children": [],
        }
    },
}

# --- the memory of earlier answers (memory.py)
EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL") or "openai/text-embedding-3-small"
# the least similarity (0 to 1) for an earlier answer to be offered. With text-embedding-3-small the same situation in other words scores
# about 0.86 and an unrelated check of the same test 0.72, so 0.8; another embedding model needs its own value.
MIN_SCORE = float(os.getenv("MEMORY_MIN_SCORE") or 0.8)
MAX_PRECEDENTS = 3  # how many earlier answers are offered for one check
COLLECTION = "clarifications"
