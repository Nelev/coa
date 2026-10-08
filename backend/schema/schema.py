from typing import Annotated

from pydantic import BaseModel, BeforeValidator, Field


def _collapse(value):
    """Collapse the whitespace and line wraps that PDF text extraction leaves in LLM output."""
    return " ".join(value.split()) if isinstance(value, str) else value


def _collapse_unit(value):
    value = _collapse(value)
    return None if value in ("", "-") else value


Clean = Annotated[str, BeforeValidator(_collapse)]
Unit = Annotated[str | None, BeforeValidator(_collapse_unit)]


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
