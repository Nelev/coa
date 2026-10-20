"""What the ReAct agent should do on each document.

A scenario is a PDF and what a correct run ends with: the outcome, the verdict of the plant's tests (a test not listed passes; None when
nothing is compared), the tools called in order, and whether the quality team is mailed. When a run pauses on a check the model is unsure
of, the scenario's `answers` are given (a test without one stays unanswered); the verdicts are the ones after the answers.
"""

from dataclasses import dataclass, field
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
SAMPLES = BACKEND / "docs"
EXTRA = BACKEND / "evals" / "docs"

COMPARE = ["load_document", "validate_document", "get_document_data", "load_plant_spec", "compare_specs"]
ASK = ["check_memory", "resolve_questions", "remember_clarifications"]
REPORT = ["write_summary", "render_ui"]
MAIL = ["notify_quality_team"]
NO_SPEC = ["load_document", "validate_document", "get_document_data", "load_plant_spec", *REPORT, *MAIL]
NOT_A_COA = ["load_document", "validate_document", "render_ui"]


@dataclass(frozen=True)
class Scenario:
    id: str
    path: Path
    outcome: str  # Conforming, Needs review, Non-conforming or Not a CoA
    tools: list[str]
    verdicts: dict[str, str] | None = field(default_factory=dict)
    answers: dict[str, str] = field(default_factory=dict)
    mails: bool = False  # only a Non-conforming lot is mailed


SCENARIOS = [
    # clean CoAs: every result inside the plant's limits
    Scenario("conforming", SAMPLES / "sample_coa_citric_acid.pdf", "Conforming", [*COMPARE, *REPORT]),
    Scenario("conforming_3_pages", SAMPLES / "sample_coa_citric_acid_3pages.pdf", "Conforming", [*COMPARE, *REPORT]),
    # every result is exactly the plant's limit: limits are inclusive
    Scenario("at_the_limits", EXTRA / "coa_at_the_limits.pdf", "Conforming", [*COMPARE, *REPORT]),
    # failures the supplier's own status hides (water 0.45 > plant max 0.4, assay 99.2 < 99.5), a missing row (arsenic), a result nobody can
    # settle (lead '< 0.5' against max 0.3: left unanswered, stays review) and an appearance a person answers
    Scenario(
        "defective",
        SAMPLES / "sample_coa_defective.pdf",
        "Non-conforming",
        [*COMPARE, *ASK, *REPORT, *MAIL],
        verdicts={
            "Appearance": "fail",
            "Assay (anhydrous basis)": "fail",
            "Water (Karl Fischer)": "fail",
            "Lead (Pb)": "review",
            "Arsenic (As)": "fail",
        },
        answers={"Appearance": "Slightly yellow is not white: it does not meet the requirement, so it fails."},
        mails=True,
    ),
    # two results in a unit the plant does not use: the run pauses, a person settles both, it finishes
    Scenario(
        "unclear_units",
        SAMPLES / "sample_coa_unclear_units.pdf",
        "Conforming",
        [*COMPARE, *ASK, *REPORT],
        answers={
            "Water (Karl Fischer)": "g/100 g is the same as %: 0.21 g/100 g is 0.21 %, which is inside the limit.",
            "Lead (Pb)": "0.2 ppb is 0.0002 ppm, far below the maximum of 0.3 ppm: it passes.",
        },
    ),
    # no plant specification (unknown product code, or no code at all): critical, nothing is compared
    Scenario("unknown_product", EXTRA / "coa_unknown_product.pdf", "Non-conforming", NO_SPEC, verdicts=None, mails=True),
    Scenario("no_product_code", EXTRA / "coa_no_product_code.pdf", "Non-conforming", NO_SPEC, verdicts=None, mails=True),
    # not CoAs: straight to the report
    Scenario("invoice", EXTRA / "invoice.pdf", "Not a CoA", NOT_A_COA, verdicts=None),
    Scenario("scanned", EXTRA / "coa_scanned.pdf", "Not a CoA", NOT_A_COA, verdicts=None),  # no text layer
]
