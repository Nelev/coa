# CoA agent

An agent that reads a **Certificate of Analysis (CoA)** sent by a supplier to a plant, extracts its data,
and checks the reported results against the **plant's own specification** for that material.

## Status

| Part | State |
|---|---|
| PDF text extraction | done |
| Validation that the document is a CoA (LLM), first step after reading the PDF | done |
| Structured extraction of the CoA (LLM) | done |
| Comparison against plant specs (LLM) → `issues` | done |
| Report page: model lays out the results as a json-render UI spec, rendered by the frontend | done |
| Supplier-approval and shelf-life checks | not started |
| `report` node (prose summary of the issues) | not started |
| Pause / resume (`is_running`, `is_paused`) | state fields only, not wired |
| API endpoint: `POST /analyze` runs the agent on an uploaded PDF and returns the UI spec | done (CORS allows `http://localhost:3000` only) |
| Frontend (Next.js + shadcn dashboard) | sidebar button uploads a PDF to `POST /analyze` and renders the returned report |

The plant limits in `backend/docs/plant_specs.json` are **placeholder values**, not real plant requirements.

## How the agent works

The agent is a [LangGraph](https://langchain-ai.github.io/langgraph/) graph in `backend/agent/agent.py`:

```
START → load_document → validate_document ─┬→ get_document_data → load_plant_spec ─┬→ compare_specs → render_ui → END
                                           │                                       └──────────────→ render_ui → END   (no plant spec)
                                           └───────────────────────────────────────────────────────→ render_ui → END   (not a CoA)
```

| Node | Uses a model? | What it does |
|---|---|---|
| `load_document` | no | Extracts the text of the PDF at `document_path` with `pypdf`. |
| `validate_document` | yes | Asks the model whether the start of the text is a supplier CoA. If not, or if the PDF has no extractable text, it records a critical `not_a_coa` issue and the graph skips to `render_ui`. |
| `get_document_data` | yes | Extracts the CoA into a structured schema: header (certificate, product, lot, dates, PO, quantities), one row per test (specification, method, result, unit, supplier status) and the conclusion. The prompt asks for verbatim values and `null` for anything not stated. |
| `load_plant_spec` | no | Looks up the CoA's `product_code` in `docs/plant_specs.json`. If there is no entry, it records a `missing_plant_spec` issue and the graph ends without calling the model. |
| `compare_specs` | yes | Sends the plant requirements and the CoA results (`test`, `result`, `unit` only, so the supplier's own limits and pass/fail can't bias the judgement) to the model with a dedicated prompt. It returns one verdict per plant test: `pass`, `fail` or `review`. |
| `render_ui` | yes | Last node. Sends the header, the per-test verdicts and the issues to the model with a prompt that lists the available components (Stack, Grid, Card, Separator, Heading, Text, Badge, Alert, Table) and how to lay out the page. The reply is a [json-render](https://github.com/vercel-labs/json-render) spec stored in `ui_spec`. Invalid JSON is retried once, then replaced by an error Alert. For a document that is not a CoA it skips the model and returns a fixed error Alert. |

Rules in the comparison prompt: judge against the plant requirements only; limits are inclusive; a `< x`
result passes a `max` limit only if x ≤ max and can't be confirmed against a `min` limit; a unit mismatch is
`review` (never converted); a qualitative result passes only if it is one of the accepted words; a required
test missing from the CoA is `fail` ("not reported").

### Guardrails around the model call

- **Structured output.** Both model calls use `with_structured_output` with the Pydantic models in
  `backend/schema/schema.py`.
- **Whitespace and unit cleanup in the schema.** The `Clean` and `Unit` types collapse the line-wrap whitespace
  that PDF extraction leaves behind and turn a unit of `-` into `None`.
- **Coverage check.** The comparison must return exactly one check for each plant test. If it doesn't, the call is
  retried once with the missing/unexpected names listed. Tests that are still missing become `review`, so a gap is
  never read as a pass.
- **Issues are derived in code**, not written by the model: every non-pass verdict becomes an `Issue`
  (`fail` → `non_conforming`/`critical`, `review` → `needs_review`/`warning`).

### State (`backend/agent/state.py`)

| Field | Content |
|---|---|
| `document_path`, `document_text` | input PDF and its extracted text |
| `supplier_materials` | CoA header fields |
| `spec_values` | test name → the supplier's printed specification |
| `tests` | structured CoA rows (test, result, unit, specification, method, status) |
| `plant_spec` | plant requirements for the CoA's product code |
| `test_checks` | one verdict per plant test, with the supplier result and plant requirement |
| `issues` | non-passing checks and missing-spec problems (see `schema.Issue`) |
| `ui_spec` | json-render spec of the report page |
| `messages`, `is_running`, `is_paused`, `report` | present but not used yet |

## The report UI (json-render)

The report page is not hand-built for each CoA. The last graph node, `render_ui`, asks the model to **design the page**
as a [json-render](https://github.com/vercel-labs/json-render) spec, and the frontend renders that spec with React.

json-render is a generative-UI framework. Instead of writing HTML or React, the model returns a JSON document that
can only use components from a **catalog**; the frontend maps each catalog component to a React implementation (the
**registry**) and renders it. A spec is a flat map of elements with a root:

```json
{
  "root": "page",
  "elements": {
    "page":  {"type": "Stack", "props": {"direction": "vertical", "gap": "lg", "align": "stretch"},
              "children": ["title", "badge"]},
    "title": {"type": "Heading", "props": {"text": "Citric Acid Anhydrous, Lot L26-09-3402", "level": "h1"}, "children": []},
    "badge": {"type": "Badge", "props": {"text": "Non-conforming", "variant": "destructive"}, "children": []}
  }
}
```

(abridged: a real spec has about 25 elements)

How the pieces fit:

| Step | Where | What happens |
|---|---|---|
| 1. Prompt | `RENDER_UI_PROMPT` in `backend/agent/prompts.py` | Lists the available components and their props (Stack, Grid, Card, Separator, Heading, Text, Badge, Alert, Table) and says how to build the page: outcome badge and recommendation, certificate card, findings as Alerts (critical first), the results table, and a "not assessed" note. The model gets only the header, the per-test verdicts and the issues, and must copy values exactly. |
| 2. Node | `render_ui` in `backend/agent/agent.py` | Sends the prompt, parses the JSON reply (fenced or not) and stores it as `ui_spec`. Invalid replies are retried once with the error, then replaced by an error Alert. |
| 3. API | `POST /analyze` in `backend/main.py` | Runs the whole graph on an uploaded PDF, streams each step's start, its one-line output and its finish (with the duration), then the `ui_spec`. |
| 4. Upload | `frontend/components/upload-button.tsx`, `report-context.tsx` | The **Upload document** button in the sidebar posts the PDF to the API and keeps the report state (idle, loading, error, done). |
| 5. Render | `frontend/components/report-renderer.tsx` | Validates the spec against the catalog (the same nine components, taken from `@json-render/shadcn`) and renders it inside the page's `<main>`. An invalid spec shows an error message instead of rendering. |

The renderer (json-render, the shadcn components and zod) is loaded on demand with `next/dynamic` and preloaded when an
upload starts, so the idle page does not download it.

### What it looks like

The report for `backend/docs/sample_coa_defective.pdf`: the outcome, the recommendation (the release decision always
stays with QA), and the certificate details.

![Report summary: non-conforming outcome, recommendation and certificate details](docs/images/report-summary.jpg)

The findings (critical in red, warnings in yellow) and the results table with one verdict per plant test.

![Report findings and results table](docs/images/report-findings.jpg)

To generate it yourself, start the backend and the frontend (see [Running it](#running-it)), click **Upload document**
and pick a CoA PDF. The report appears after about a minute.

## Repository layout

```
docs/images/        screenshots used in this README
backend/
  agent/            LangGraph graph (agent.py), prompts (prompts.py) and state (state.py)
  schema/           Pydantic models: CoA extraction, check verdicts, issues (schema.py)
  docs/             sample CoAs and the plant specification
    sample_coa_citric_acid.pdf    conforming CoA (should produce no issues)
    sample_coa_defective.pdf      CoA with five seeded defects
    plant_specs.json              plant requirements per product code
  scripts/eval_compare.py         end-to-end check against the real model
  tests/                          unit tests (mocked model)
  main.py                         FastAPI app: /health and POST /analyze
frontend/           Next.js + shadcn dashboard; app/page.tsx shows the report inside <main>
  components/upload-button.tsx     sidebar button: picks a PDF and sends it to the API
  components/report-context.tsx    report state (idle / loading / error / done), the per-step timings and the POST /analyze call
  components/report-view.tsx       what <main> shows for each state, including the step checklist with live and final durations
  components/report-renderer.tsx   json-render catalog + registry (shadcn components)
```

### Plant specification format

`docs/plant_specs.json` maps product codes to requirements. Test names must match the CoA's names exactly.

- numeric test: `{"test": "Water (Karl Fischer)", "type": "numeric", "max": 0.4, "unit": "%"}` (`min` and/or `max`)
- qualitative test: `{"test": "Appearance", "type": "qualitative", "accepted": ["conforms", "complies"], "requirement": "..."}`

`approved_suppliers` and `min_remaining_shelf_life_days` are in the file but nothing reads them yet.

## Running it

Backend (Python 3.10+, developed on 3.14, with a virtualenv in `backend/.venv`):

```bash
cd backend
uv venv .venv   # first time only
uv pip install --python .venv/bin/python -r requirements-dev.txt
```

The model is reached through [OpenRouter](https://openrouter.ai/) (`openai/gpt-5-mini`). Put your key in
`backend/.env` (gitignored; loaded automatically with `python-dotenv`):

```
OPENROUTER_API_KEY=your-openrouter-api-key-here
```

Run the agent on the sample CoA, or on another PDF:

```bash
cd backend
.venv/bin/python -m agent.agent                              # docs/sample_coa_citric_acid.pdf
.venv/bin/python -m agent.agent docs/sample_coa_defective.pdf
.venv/bin/python -m agent.agent path/to/other.pdf
```

It prints the extracted header, each test with its result and the supplier's specification, the verdict for
every plant test, and the list of issues. On the defective sample the issues are:

| Test | Seeded defect | Expected |
|---|---|---|
| Water (Karl Fischer) | 0.45 %: passes the supplier's 0.5 limit, not the plant's 0.4 | critical |
| Assay (anhydrous basis) | 99.2 %: below min 99.5 | critical |
| Arsenic (As) | row removed from the CoA | critical |
| Lead (Pb) | `< 0.5`: can't be confirmed against max 0.3 | warning |
| Appearance | "Slightly yellow powder": not an accepted result | warning |

Backend API (`GET /health`, `POST /analyze`):

```bash
cd backend && .venv/bin/uvicorn main:app --reload
```

`POST /analyze` takes a PDF as multipart form data (field `file`) and runs the agent on it. A run takes a minute or
more, because the agent makes several model calls, so the response is a stream of JSON lines (NDJSON) built from
LangGraph's `tasks` and `custom` stream modes:

| Line | Meaning |
|---|---|
| `{"start": "<node>"}` | the step is about to run |
| `{"output": "...", "node": "<node>"}` | the step reported one display line about what it produced. Each node writes it with LangGraph's stream writer (`writer(...)`, received as an argument), which arrives in the `custom` stream mode; the raw node output is not sent, because it includes the whole PDF text and UI spec |
| `{"step": "<node>", "ms": 1840}` | the step finished after `ms` milliseconds |
| `{"done": <json-render UI spec>}` | the report; the last line of a successful run |
| `{"error": "..."}` | the run failed |

Steps the graph routes around (for example everything between `validate_document` and `render_ui` for a document that
is not a CoA) send no lines, and the frontend shows them as skipped.

```bash
curl -N -F "file=@docs/sample_coa_defective.pdf" localhost:8000/analyze
```

Frontend:

```bash
cd frontend && npm install && npm run dev
```

Start the backend (see above) and the frontend, then click **Upload document** in the sidebar and pick a CoA PDF
(for example `backend/docs/sample_coa_defective.pdf`). The report appears in the page after about a minute. The
frontend calls `http://localhost:8000`; set `NEXT_PUBLIC_API_URL` to use another address.

The component list in `RENDER_UI_PROMPT` (`backend/agent/prompts.py`) and the catalog in
`frontend/components/report-renderer.tsx` must be kept in sync by hand.

## Testing

```bash
cd backend
.venv/bin/python -m pytest -q           # unit tests, mocked model, no API key needed
.venv/bin/python -m scripts.eval_compare   # calls the real model on both sample CoAs, diffs the verdicts
```

The unit tests cover issue derivation, the retry and the fallback to `review`, and the missing-spec routing.
The eval script is slower (several model calls) and needs `OPENROUTER_API_KEY`. It exits non-zero if any
verdict differs from the expected one.

## Known limitations

- `pypdf` only reads text-based PDFs; scanned CoAs would need OCR.
- The model's output casing varies between runs (for example the supplier name is sometimes printed in capitals);
  values are copied from the document, not normalised.
- Numeric comparison is done by the model. The retry and the eval script exist to guard it; doing the numeric
  tests in Python and sending only qualitative rows to the model is a possible next step.
- Test names on the CoA must match the plant specification exactly; there is no fuzzy matching yet.
- The report UI is written by the model, so values in it are retyped by the model. The verdicts and issues stay in state
  from `compare_specs`; the page is a display layer. The frontend validates the spec against its catalog before rendering.
