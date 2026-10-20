from ragas.metrics import numeric_metric
from ragas.metrics.result import MetricResult


@numeric_metric(name="outcome_correct")
def outcome_correct(prediction: str, expected: str):
    """1 when the run ended with the expected outcome (Conforming, Needs review, Non-conforming or Not a CoA)."""
    return MetricResult(value=float(prediction == expected), reason=f"Prediction: {prediction}, Expected: {expected}")


@numeric_metric(name="verdict_accuracy")
def verdict_accuracy(prediction: dict, expected: dict | None):
    """The share of the plant's tests with the expected verdict (a test not listed in `expected` should pass).

    `expected` is None when nothing should be compared (no plant specification, or not a CoA): then nothing must have been.
    """
    if expected is None:
        return MetricResult(value=float(not prediction), reason=f"Nothing should be compared, compared: {list(prediction)}")
    wrong = {t: v for t, v in prediction.items() if v != expected.get(t, "pass")}
    return MetricResult(value=1 - len(wrong) / len(prediction) if prediction else 0.0, reason=f"Wrong verdicts: {wrong}")


@numeric_metric(name="mail_correct")
def mail_correct(prediction: bool, expected: bool):
    """1 when the quality team was mailed exactly when expected (for a Non-conforming lot only)."""
    return MetricResult(value=float(prediction == expected), reason=f"Mailed: {prediction}, Expected: {expected}")


@numeric_metric(name="tools_correct")
def tools_correct(prediction: list, expected: list):
    """1 when the agent called exactly the expected tools, in the expected order (a call a tool refused counts)."""
    return MetricResult(value=float(prediction == expected), reason=f"Prediction: {prediction}, Expected: {expected}")
