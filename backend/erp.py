"""The plant's ERP, as far as the agent needs it: material master, with the plant specification.

This is a demo stand-in that reads `docs/erp_demo.json`. Connecting a real ERP means rewriting this function;
nothing else in the agent knows where the data comes from.
"""

import json
from functools import lru_cache
from pathlib import Path

ERP_PATH = Path(__file__).resolve().parent / "docs" / "erp_demo.json"


@lru_cache
def _load(path: Path) -> dict:
    return json.loads(path.read_text())


def get_material(product_code: str | None) -> dict | None:
    """The material master record for a product code: name, plant tests, approved suppliers, minimum shelf life."""
    return _load(ERP_PATH)["materials"].get(product_code)
