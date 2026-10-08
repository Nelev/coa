"""Run the agent on the sample CoAs and check the verdicts against the expected ones.

Calls the real model; needs OPENROUTER_API_KEY. Run from backend/:
    .venv/bin/python -m scripts.eval_compare
"""

import sys

from agent.agent import DOCS_DIR, app

# Anything not listed is expected to pass.
EXPECTED = {
    "sample_coa_citric_acid.pdf": {},
    "sample_coa_defective.pdf": {
        "Appearance": "review",  # qualitative result not in the accepted list
        "Assay (anhydrous basis)": "fail",  # 99.2 < min 99.5
        "Water (Karl Fischer)": "fail",  # 0.45 passes the supplier limit (0.5) but not the plant's (0.4)
        "Lead (Pb)": "review",  # '< 0.5' cannot confirm the plant's max 0.3
        "Arsenic (As)": "fail",  # row removed from the CoA: not reported
    },
}


def main() -> int:
    failures = 0
    for filename, exceptions in EXPECTED.items():
        result = app.invoke({"document_path": str(DOCS_DIR / filename)})
        verdicts = {c["test"]: c["verdict"] for c in result["test_checks"]}
        wrong = {t: (v, want) for t, v in verdicts.items() if v != (want := exceptions.get(t, "pass"))}
        print(f"{filename}: {len(verdicts) - len(wrong)}/{len(verdicts)} as expected")
        for test, (got, want) in wrong.items():
            print(f"  MISMATCH {test}: got {got}, expected {want}")
        failures += len(wrong)
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
