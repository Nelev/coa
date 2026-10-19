from typing import Annotated, Literal

from pydantic import BaseModel, BeforeValidator, Field


def _collapse(value):
    """Collapse the whitespace and line wraps that PDF text extraction leaves in LLM output."""
    return " ".join(value.split()) if isinstance(value, str) else value


def _collapse_unit(value):
    value = _collapse(value)
    return None if value in ("", "-") else value


Clean = Annotated[str, BeforeValidator(_collapse)]
Unit = Annotated[str | None, BeforeValidator(_collapse_unit)]


class DocumentCheck(BaseModel):
    is_coa: bool = Field(description="True only if the document is a supplier Certificate of Analysis")
    reason: str = Field(description="One short sentence saying what the document is and why it is or is not a CoA")


class CoAHeader(BaseModel):
    certificate_number: Clean | None = Field(None, description="Certificate / CoA number")
    issue_date: Clean | None = Field(None, description="Certificate issue date, ISO format YYYY-MM-DD")
    supplier: Clean | None = Field(None, description="Name of the supplier issuing the certificate")
    product_name: Clean | None = None
    product_code: Clean | None = None
    lot_number: Clean | None = Field(None, description="Lot / batch number")
    manufacturing_date: Clean | None = Field(None, description="ISO format YYYY-MM-DD")
    expiry_date: Clean | None = Field(None, description="Expiry or retest date, ISO format YYYY-MM-DD")
    cas_number: Clean | None = None
    lot_quantity: Clean | None = Field(None, description="Total lot quantity, with unit")
    shipped_quantity: Clean | None = Field(None, description="Quantity shipped to the customer, with unit")
    customer: Clean | None = Field(None, description="Receiving customer / plant")
    po_number: Clean | None = Field(None, description="Customer purchase order number")


class TestResult(BaseModel):
    test: Clean = Field(description="Test name exactly as printed, without any '(result)' or '(spec)' suffix")
    specification: Clean | None = Field(None, description="Specification limit verbatim, e.g. 'max 0.5' or '99.5 - 100.5'")
    method: Clean | None = None
    result: Clean = Field(description="Reported result verbatim, including '<' or '>' signs, without the unit")
    unit: Unit = None
    status: Clean | None = Field(None, description="Pass/fail status as reported by the supplier, if any")


class CoAData(BaseModel):
    header: CoAHeader
    tests: list[TestResult] = Field(description="One entry per row of the analytical results table")
    conclusion: Clean | None = Field(None, description="Overall conformity statement of the supplier")


class TestCheck(BaseModel):
    test: str = Field(description="Test name exactly as written in the plant requirements")
    verdict: Literal["pass", "fail", "review"]
    reason: str = Field(description="One sentence quoting the CoA result and the plant requirement verbatim")
    unsure: bool = Field(False, description="True when you are not sure of this verdict and a person should review it")
    unsure_reason: str | None = Field(None, description="Why you are not sure, in one sentence; always given when unsure is true")


class ComparisonResult(BaseModel):
    checks: list[TestCheck] = Field(description="Exactly one check per test in the plant requirements")


class Issue(BaseModel):
    kind: Literal["not_a_coa", "non_conforming", "needs_review", "missing_plant_spec"]
    severity: Literal["critical", "warning"]
    message: str
    test: str | None = None
    supplier_result: str | None = None
    plant_requirement: str | None = None


# what a person's answer is about, to filter the memory by; the model picks one, and anything else is `other`
TOPICS = (
    "unit_mismatch",
    "detection_limit",
    "qualitative_wording",
    "missing_result",
    "unreadable_value",
    "spec_ambiguity",
    "other",
)


def _known_topic(value):
    topic = str(value).strip().lower().replace(" ", "_").replace("-", "_")
    return topic if topic in TOPICS else "other"


class ClarificationNote(BaseModel):
    test: Clean = Field(description="The test name, verbatim")
    summary: Clean = Field(
        description="One sentence stating the rule the answer gives, so that it can be applied to another lot: no lot number, date or name"
    )
    topic: Annotated[str, BeforeValidator(_known_topic)] = Field(description=f"Exactly one of: {', '.join(TOPICS)}")


class ClarificationNotes(BaseModel):
    notes: list[ClarificationNote] = Field(description="Exactly one note per answer given")


# who an answer to a flagged check is kept for: the lots of that product, every product, or nobody (this lot only: nothing is saved)
Scope = Literal["product", "global", "none"]
DEFAULT_SCOPE: Scope = "product"


# what the API takes from a person, in the body of POST /jobs/{id}/answer and POST /jobs/{id}/decision
class Answer(BaseModel):
    answers: dict[str, str]  # test name -> the answer; a test left out or blank keeps the agent's verdict
    by: str
    remember: dict[str, Scope] = {}  # test name -> who the answer is kept for; a test left out gets the default, DEFAULT_SCOPE


class Decision(BaseModel):
    decision: Literal["approved", "rejected", "on_hold"]
    by: str
    reason: str = ""
