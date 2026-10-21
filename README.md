# CoA agent

When a plant receives a raw material, the supplier sends a **Certificate of Analysis (CoA)**: a PDF with the lot's test results (assay,
water, heavy metals, appearance, ...) and the limits the supplier tested against. Someone in quality then has to check every
result against the **plant's own specification** for that material, which is often stricter than the supplier's, before the lot can
be released to production.

This app does that check. You upload the CoA PDFs; an agent reads each one, extracts the data, compares every result with the plant's
requirements and writes a report: **Conforming**, **Needs review** or **Non-conforming**, with the reason for each non-passing test.
When the agent cannot tell (a result in another unit, say), it stops and asks you, and it remembers your answer for the next time. The
**release decision is always a person's**: the agent prepares the report, and QA approves, holds or rejects the lot.

The stack is a [LangGraph](https://langchain-ai.github.io/langgraph/) agent (a ReAct agent calling the steps as tools; a fixed graph with
the same steps is kept for comparison) behind a FastAPI job queue, Postgres with pgvector for jobs, checkpoints and memory, and a Next.js
dashboard whose report page is **designed by the model** as a [json-render](https://github.com/vercel-labs/json-render) spec. Sign-in
is WorkOS AuthKit.

The plant limits in `backend/docs/erp_demo.json` are **placeholder values**, not real plant data.

## The workflow

1. **Upload.** Click **Upload documents** (or drop PDFs anywhere on the page). Each file becomes a run in the overview, sorted by priority: a
   run waiting for your answer first, then the ones in progress or failed, non-conforming lots, lots that need review and conforming
   ones, with the lots a person has already decided last. Filter by status, or search by file, product, lot or supplier.

   ![The runs overview, with a run that has a question for you at the top](docs/images/workflow-1-overview.jpg)

2. **The agent works.** A run takes about two minutes (it makes several model calls). The row shows the current step and a progress bar,
   and a worker takes the next file while others wait in the queue.

   ![A run being analyzed in the overview](docs/images/workflow-2-analyzing.jpg)

3. **Follow it, step by step.** Open the run and the **Activity** tab lists the steps as the agent finishes them: reading the PDF, checking
   it is a CoA, extracting the data, finding the plant specification, comparing the results. Which steps run is the model's choice, so a
   document that is not a CoA skips straight to the report.

   ![The Activity tab of a run: the steps the agent has finished and the one it is on](docs/images/workflow-3-activity.jpg)

4. **Answer what it is unsure about.** When the comparison flags a check as unsure (here the CoA reports water in `g/100 g` and lead in `ppb`,
   and the plant limits are in `%` and `ppm`), the agent **stops** and asks you, with its reason and the figures. The worker is freed
   while it waits. Answers given to similar checks before are offered under **Answered before**, to reuse or ignore. Once you answer, the
   agent judges those tests again with your answer in hand and continues; a test you leave blank keeps its verdict. You choose whether
   an answer is kept for the product's future lots, for every product, or for this lot only.

   ![A run that stopped to ask for review of two unit mismatches](docs/images/workflow-4-needs-answer.jpg)

5. **Read the report** (below): the outcome and the count of passing, to-review and failing tests, the certificate's details, one alert per finding and a table with
   a verdict for every plant test. **Open the CoA** opens the uploaded PDF, which is kept as the record the decision is about.

6. **Decide.** On a phone or tablet a bar at the bottom of the run page opens the decision (as in the screenshot); on a wide screen the form sits in a
   column beside the report. Approving a lot the agent did not find conforming, holding
   and rejecting all need a reason, and rejecting and approving are final. The decision, who took it and why are stored with the run.
   A non-conforming lot is also mailed to the quality team, when SMTP is set up.

   ![The decision panel for a non-conforming lot: approve anyway, put on hold or reject, each with a reason](docs/images/workflow-5-decision.jpg)

## How the agent works

The check was built **twice, for development and learning purposes**, with the same steps and the same prompts and schema:

| | Fixed graph | ReAct agent |
|---|---|---|
| Code | `backend/agent/` | `backend/react_agent/` |
| Who picks the next step | the graph's edges | the model, from each tool's answer |
| Steps are | nodes | tools |
| Run by | `python -m agent.agent` and `scripts/eval_compare.py` | **the API** (`main.py`) |
| Mails a non-conforming lot | no | yes, with the `notify_quality_team` tool |

The API, the job list and everything below the diagram describe the ReAct agent; the fixed graph is kept as the first version and as a
point of comparison. Both are [LangGraph](https://langchain-ai.github.io/langgraph/) graphs and share the Pydantic models in
`backend/schema/schema.py` and the demo ERP. Each has its own copy of the prompts and the state (`prompts.py`, `state.py`), and
`react_agent/tools.py` re-implements the steps instead of calling `agent/agent.py`. Only the ReAct agent uses the `get_material` and `send_email`
tools in `backend/agent/tools.py`; the fixed graph reads the ERP directly.

### The fixed graph (`backend/agent/agent.py`)

```
START → load_document → validate_document ─┬→ get_document_data → load_plant_spec ─┬→ compare_specs → write_summary → render_ui → END
                                           │                                       └──────────────→ write_summary → render_ui → END   (no plant spec)
                                           └─────────────────────────────────────────────────────→ render_ui → END                  (not a CoA)
```

Each node does what the tool of the same name does (table below), in an order the edges fix: the routing is plain Python
(`route_after_validation`, `route_after_plant_spec`), so it never skips or repeats a step. It has no `notify_quality_team`: nothing mails a lot.

### The ReAct agent (`backend/react_agent/react_agent.py`, run by the API)

It has two nodes, `agent` (the model, with the tools bound) and `tools` (a `ToolNode` that runs the calls). The model reads each tool's short
answer and picks the next call, following the order in its system prompt:

```
START → agent ⇄ tools → END        (the agent ends the run when it makes no tool call)

load_document → validate_document ─┬→ get_document_data → load_plant_spec ─┬→ compare_specs → check_memory* → resolve_questions* → remember_clarifications* → write_summary → render_ui → notify_quality_team*
                                   │                                       └──────────────→ write_summary → render_ui → notify_quality_team*   (no plant spec)
                                   └─────────────────────────────────────────────────────→ render_ui                                          (not a CoA)
                                                                                         * only a non-conforming lot is mailed
```

The tools are in `backend/react_agent/tools.py`. Each returns its state update (the document text, the tests and the UI spec stay in the state, not in
the conversation) and a short answer for the model. A tool called too early answers what to call first; any other failure (the ERP down, an invalid
model reply) fails the run. A run is capped at `RECURSION_LIMIT` graph steps (`main.py`); a normal check takes about 18. Each model call is capped at `MAX_OUTPUT_TOKENS` (reasoning included) and a run at `MAX_RUN_OUTPUT_TOKENS`, both in `react_agent/const.py`; a reply cut off by the cap fails the run. The price of letting the model
choose: a run takes longer (1.5 to 2 minutes on the conforming samples and about 3 on the defective one, measured with `gpt-5-mini`) and the model can ignore its prompt, which is why the mail is a guarded tool.

The steps (the fixed graph's nodes, the ReAct agent's tools):

| Step | Uses a model? | What it does |
|---|---|---|
| `load_document` | no | Extracts the text of the PDF at `document_path` with `pypdf`. |
| `validate_document` | yes | Asks the model whether the start of the text is a supplier CoA. If not, or if the PDF has no extractable text, it records a critical `not_a_coa` issue and the model skips to `render_ui`. |
| `get_document_data` | yes | Extracts the CoA into a structured schema: header (certificate, product, lot, dates, PO, quantities), one row per test (specification, method, result, unit, supplier status) and the conclusion. The prompt asks for verbatim values and `null` for anything not stated. |
| `load_plant_spec` | no | Looks up the CoA's `product_code` in the ERP's material master (`docs/erp_demo.json`). If there is no entry, it records a `missing_plant_spec` issue and the model skips `compare_specs`. It runs the `get_material` tool itself. |
| `compare_specs` | yes | Sends the plant requirements and the CoA results (`test`, `result`, `unit` only, so the supplier's own limits and pass/fail can't bias the judgement) to the model with a dedicated prompt. It returns one verdict per plant test: `pass`, `fail` or `review`. |
| `check_memory` | no | ReAct agent only. When `compare_specs` flagged checks, looks in the memory (below) for what a person answered when a check like each one came up, and attaches what it finds (`precedents`) to the question. A person still decides: the answers found are shown, never applied. A memory that cannot be read finds nothing and never stops the run. |
| `resolve_questions` | yes | ReAct agent only. When the model flags a check as `unsure` (with its reason) in `compare_specs`, whatever its verdict, this tool pauses the run with `interrupt()` for a person to review it and, once answered, judges those tests again with the answer, which it records in `clarifications`. It is its own tool because a resumed run starts the interrupted tool over: the model calls of `compare_specs` must not run twice. `write_summary` refuses to run while a flagged check is unreviewed, and this tool while the memory is unchecked. The job waits as `needs_input` (the worker is freed) until `POST /jobs/{id}/answer`; the answer survives a restart. |
| `remember_clarifications` | yes | ReAct agent only. Keeps what a person answered in the memory: one model call writes a one-sentence summary and a topic for each answer, which are embedded with it. The person chose who an answer is kept for (the product's future lots, every product, or this lot only, which keeps nothing). It takes no arguments, never stops the run when it fails, and `write_summary` waits for it. |
| `write_summary` | no | Works out the outcome (Conforming, Needs review or Non-conforming) from the issues and the verdicts, and stores the few facts the job list shows in `result`. |
| `render_ui` | yes | Last step. Sends the header, the per-test verdicts and the issues to the model with a prompt that lists the available components (Stack, Grid, Card, Separator, Collapsible, Accordion, Heading, Text, Badge, Alert, Progress, Table) and how to lay out the page. The reply is a [json-render](https://github.com/vercel-labs/json-render) spec stored in `ui_spec`. Invalid JSON is retried once, then replaced by an error Alert. For a document that is not a CoA it skips the model and returns a fixed error Alert. |
| `notify_quality_team` | no | ReAct agent only. Mails the plant's quality team about a non-conforming lot (product, lot, supplier, test counts, a link to the job). It takes no arguments and does nothing for any other outcome: the model, told to mail only non-conforming lots, mailed a conforming one in every live run. |

#### The memory (`backend/react_agent/memory.py`)

What people answer is kept in a LangChain vector store, [`PGVector`](https://docs.langchain.com/oss/python/integrations/vectorstores/pgvector)
from `langchain-postgres`: pgvector holds the embeddings, and an `OpenAIEmbeddings` (through OpenRouter) makes them. Its tables
(`langchain_pg_collection`, `langchain_pg_embedding`) sit in the schema of the checkpoints (`CHECKPOINT_SCHEMA`) and are made when the API starts.
An answer is a `Document` with the id `<run>:<test>` (keeping it again replaces it). Its text, which is embedded, is the test, why the agent was
unsure, the answer and its summary; its metadata holds the rest, among it the `scope` (`product` or `global`), the `product_code` and the `test`.
`check_memory` runs one `similarity_search_with_relevance_scores` per flagged check, filtered to the answers for the same test of the same product or
for every product, and offers the closest ones scoring at least `MEMORY_MIN_SCORE`.

Rules in the comparison prompt: judge against the plant requirements only; limits are inclusive; a `< x`
result passes a `max` limit only if x ≤ max and can't be confirmed against a `min` limit; a unit mismatch is
`review` (never converted); a qualitative result passes only if it is one of the accepted words; a required
test missing from the CoA is `fail` ("not reported").

### Guardrails around the model call

- **Structured output.** The structured model calls (validation, extraction, comparison) use `with_structured_output` with the Pydantic models in
  `backend/schema/schema.py`.
- **Whitespace and unit cleanup in the schema.** The `Clean` and `Unit` types collapse the line-wrap whitespace
  that PDF extraction leaves behind and turn a unit of `-` into `None`.
- **Coverage check.** The comparison must return exactly one check for each plant test. If it doesn't, the call is
  retried once with the missing/unexpected names listed. Tests that are still missing become `review`, so a gap is
  never read as a pass.
- **Issues are derived in code**, not written by the model: every non-pass verdict becomes an `Issue`
  (`fail` → `non_conforming`/`critical`, `review` → `needs_review`/`warning`).

### State (`backend/agent/state.py`; `backend/react_agent/state.py` is a copy with the extra fields marked below)

| Field | Content |
|---|---|
| `document_path`, `document_text` | input PDF and its extracted text |
| `filename`, `job_id` | the uploaded file's name and the job's id (also the thread id): what the task message and the mail's link name |
| `supplier_materials` | CoA header fields |
| `spec_values` | test name → the supplier's printed specification |
| `tests` | structured CoA rows (test, result, unit, specification, method, status) |
| `plant_spec` | the ERP's material record for the CoA's product code: plant requirements, approved suppliers, minimum shelf life |
| `test_checks` | one verdict per plant test, with the supplier result and plant requirement |
| `issues` | non-passing checks and missing-spec problems (see `schema.Issue`) |
| `open_questions` | ReAct agent: the checks flagged as unsure that wait for a person, each with its reason, the figures and the `precedents` `check_memory` found |
| `clarifications` | ReAct agent: what a person answered (test, reason, answer, who, scope; summary and topic once kept) |
| `memory_saved` | ReAct agent: `remember_clarifications` has run |
| `ui_spec` | json-render spec of the report page |
| `messages` | ReAct agent: the conversation (the task, the model's tool calls and each tool's short answer). Fixed graph: `write_summary` puts the analysis (outcome, counts, header, tests, issues) here as compact JSON and `render_ui` reads it |
| `result` | what the job list shows: outcome, verdict counts, product, lot, supplier (written by `write_summary`, or by `render_ui` for a non-CoA) |
| `cost`, `input_tokens`, `output_tokens` | what the run's model calls used: USD charged by OpenRouter and tokens (output includes reasoning). Every node or tool that calls the model returns its calls' usage (a retry included), and so does the ReAct agent's own `agent` node and the fields add up (`operator.add`), so the checkpoint holds the total of the whole run, restarts included. A call whose provider reports no cost counts 0 |
| `is_running`, `is_paused`, `report` | present but not used yet |

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
| 1. Prompt | `RENDER_UI_PROMPT` in `backend/react_agent/prompts.py` | Lists the available components and their props (the twelve in the table above) and says how to build the page: outcome badge and recommendation, certificate card, findings as Alerts (critical first), the results table, and a "not assessed" note. The model gets only the header, the per-test verdicts and the issues, and must copy values exactly. |
| 2. Tool | `render_ui` in `backend/react_agent/tools.py` | Sends the prompt, parses the JSON reply (fenced or not) and stores it as `ui_spec`. Invalid replies are retried once with the error, then replaced by an error Alert. |
| 3. API | `POST /jobs` in `backend/main.py` | Queues the agent for an uploaded PDF; a worker runs it, records what each tool is doing, then the `ui_spec`. |
| 4. Upload | `frontend/components/upload-button.tsx`, `report-context.tsx` | The **Upload documents** button (or a drop anywhere on the page) posts the PDFs to the API, three at a time, which queues them, and polls the jobs once a second while any is unfinished (slower while the server cannot be reached). There is one run per file (queued, loading, error, done). |
| 5. Render | `frontend/components/report-renderer.tsx` | Validates the spec against the catalog (the same twelve components, taken from `@json-render/shadcn`) and renders it inside the page's `<main>`. An invalid spec shows an error message instead of rendering. |

The renderer (json-render, the shadcn components and zod) is loaded on demand with `next/dynamic` and preloaded when an
upload starts, so the idle page does not download it.

### What it looks like

The report of `backend/docs/sample_coa_defective.pdf`, a CoA with five seeded defects (see the table under *Running it*). Above the tabs,
the lot, the verdict and the count of the test results are part of the page; the **Report** tab below is the json-render spec: the
certificate title, an outcome Alert and the certificate details. The release decision always stays with QA (the **Decide** bar at the
bottom, on a narrow screen).

![Run page: verdict, test counts and the start of the report](docs/images/report-summary.jpg)

The findings, one Alert per non-passing check, critical ones (red) before warnings (yellow). Each has the CoA's result and the plant's
requirement.

![Report findings](docs/images/report-findings.jpg)

The results table, with one verdict per plant test.

![Report results table](docs/images/report-results.jpg)

To generate it yourself, start the backend and the frontend (see [Running it](#running-it)), click **Upload documents**
and pick a CoA PDF. The report appears after about two minutes.

## Repository layout

```
docs/images/        screenshots used in this README
docs/ux-redesign-plan.md   the UX and accessibility plan for the frontend
docker-compose.yml  the stack: Postgres with pgvector (db), the API (backend) and the frontend
backend/
  react_agent/      the ReAct agent main.py runs (the second implementation): the agent (react_agent.py), the steps of the check as tools (tools.py), what people answered about unsure checks (memory.py), its prompts (prompts.py), state (state.py) and constants (const.py)
  agent/            the fixed graph, the first implementation (agent.py, prompts.py, state.py), and the get_material and send_email tools (tools.py) that the ReAct agent's tools use
  schema/           Pydantic models: CoA extraction, check verdicts, issues, the API's answer and decision bodies (schema.py)
  erp.py            the demo ERP: the material master, read from docs/erp_demo.json
  docs/             sample CoAs and the demo ERP data
    sample_coa_citric_acid.pdf    conforming CoA (should produce no issues)
    sample_coa_citric_acid_3pages.pdf  the same kind of conforming CoA over three pages, for bigger documents
    sample_coa_defective.pdf      CoA with five seeded defects
    erp_demo.json                 materials with their plant requirements
  scripts/eval_compare.py         end-to-end check against the real model (runs the fixed graph)
  evals/                          the evaluation of the ReAct agent against the real model: scenarios, metrics, the runner that writes an Excel file
  tests/                          unit tests (mocked model, a real Postgres): API and queue, upload limits, database, sign-in, memory, comparison, validation, mail
  main.py                         FastAPI app: /health, the /jobs endpoints (create, list, get, pdf, answer, decision) with their per-address rate limit, plus the job queue and its workers
  auth.py                         checks the WorkOS access token on every /jobs request
  middleware.py                   refuses an upload that is too large or has no Content-Length, before its body is read
  notify.py                       the mail about a non-conforming lot (SMTP): its text, and the sending (SMTP, or Resend's HTTP API) the notify_quality_team and send_email tools do
  jobs.py                         the jobs store (the `runs` and `users` tables in Postgres, with the decisions), the uploaded PDFs (in backend/data/, gitignored) and `open_checkpointer`, the agent's Postgres checkpointer
  migrations/, alembic.ini        the database schema, as Alembic migrations (versions/0001_users_and_runs.py is the first); the API applies them when it starts
  Dockerfile                      the API's image (one uvicorn process)
frontend/           Next.js + shadcn dashboard, light / dark / system theme (tokens in app/globals.css, contrast checked by lib/contrast.test.ts); its Dockerfile builds the production image
  proxy.ts                         signs people in with WorkOS AuthKit; signed-out visitors go to /login
  app/(auth)/login/page.tsx        the login page; app/auth/ and app/sign-in/ hold the sign-in, callback, sign-out and token actions
  app/(app)/page.tsx               the overview; app/(app)/runs/[id]/page.tsx is the report page
  components/upload-button.tsx     picks one or more PDFs and sends them to the API
  components/report-context.tsx    the list of runs (queued / loading / waiting / error / done), the jobs polled from the API, and the calls that upload, answer and decide
  components/offline-banner.tsx    the banner for a server that cannot be reached, or a session that has ended
  components/overview.tsx          filters, search and sort, the list of rows, the empty state
  components/run-row.tsx           one row: status, product and lot, verdict counts or progress, time
  components/run-page.tsx          the report page: header, previous / next run, Report and Activity tabs
  components/run-summary.tsx       the top of the run page: title, status, the verdict in words, and the pass / to review / fail counts (verdict-bar.tsx)
  components/decision-bar.tsx      the bar at the foot of a narrow screen that opens the decision panel (from the lg breakpoint the form sits beside the report)
  components/answer-panel.tsx      the checks a paused agent flagged as unsure (a run that needs your review), and the form that answers them
  components/account-context.tsx   who is signed in (name, email), for the forms
  components/acting-as.tsx         "Deciding as ..." / "Answering as ...": the signed-in person, shown and not chosen
  components/decision-panel.tsx    approve / hold / reject a finished run, as the signed-in person, with a reason
  components/page-dropzone.tsx     drop PDFs anywhere; components/live-announcer.tsx tells screen readers when a run ends
  lib/runs.ts                      filter, search, priority sort and tallies of the runs
  lib/api.ts                       the one way the frontend calls the API: the access token, a timeout, one retry after a 401, and typed errors (`ApiError`: auth, network or server)
  lib/access-token.ts              the session's access token for the API, cached until shortly before it expires and seeded with the one the page was rendered with
  lib/uploads.ts                   the toasts for a batch of uploads, and `mapLimit`, which keeps them to three at a time
  components/report-renderer.tsx   json-render catalog + registry (shadcn components)
```

### The demo ERP (`docs/erp_demo.json`)

`erp.py` reads this file; connecting a real ERP means rewriting its one function (`get_material`).

`materials` maps product codes to the plant's requirements. Test names must match the CoA's names exactly.

- numeric test: `{"test": "Water (Karl Fischer)", "type": "numeric", "max": 0.4, "unit": "%"}` (`min` and/or `max`)
- qualitative test: `{"test": "Appearance", "type": "qualitative", "accepted": ["conforms", "complies"], "requirement": "..."}`

Only `tests` is used. A material also carries `specification_ref`, `approved_suppliers` and `min_remaining_shelf_life_days`,
which are **not checked yet**: changing them has no effect on a verdict, and a CoA from a supplier that is not approved, or
with too little shelf life left, is not flagged.

## Running it

**With Docker** (Compose v2.24+): the database, the API and the frontend, each in a container. First put the settings described below in
`backend/.env` and `frontend/.env.local` (the WorkOS redirect URI is `http://localhost:3000/auth/callback`), then:

```bash
docker compose up -d --build
```

Open <http://localhost:3000>; the API is on `localhost:8000`. `DATABASE_URL` and `CORS_ORIGINS` are set by `docker-compose.yml`; the
uploaded PDFs are kept in the `uploads` volume and the database in `db-data`. The frontend's `NEXT_PUBLIC_*` values are written into its
bundle when the image is built, so rebuild (`--build`) after changing them. To use other host ports set `BACKEND_PORT`, `FRONTEND_PORT` and
`DB_PORT` (the WorkOS redirect URI has to follow the frontend's). `docker compose up -d db` starts only the database, for running the
two from source, as follows.

**From source.** Backend (Python 3.10+, developed on 3.14, with a virtualenv in `backend/.venv`):

```bash
cd backend
uv venv .venv   # first time only
uv pip install --python .venv/bin/python -r requirements-dev.txt
```

The jobs, the agent's checkpoints and its memory (the answers people gave, with their embeddings) are kept in Postgres with the
[pgvector](https://github.com/pgvector/pgvector) extension. For development, `docker compose up -d db` (from the repository root) starts one on `localhost:5432`; any
Postgres with pgvector does, and the role needs the right to create the `vector` extension and a schema. Point the API at it in `backend/.env`:

```
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/coa
```

The schema is managed with [Alembic](https://alembic.sqlalchemy.org/) (`backend/migrations/`). The API applies the migrations that are
missing when it starts, so a fresh database gets, in `public`, the tables `users` (the people who sign in) and `runs` (the jobs, each
pointing to its `owner`) and `alembic_version` (which migration it is at); the agent's checkpoint tables are made by LangGraph in the
schema `langgraph`. To change the schema, add a migration (there are no models, so it is written by hand) and start the API, or apply it
yourself, from `backend/` with `DATABASE_URL` set:

```bash
.venv/bin/alembic revision -m "add a column"   # then edit the new file in migrations/versions/
.venv/bin/alembic upgrade head                 # apply what is missing; `alembic downgrade -1` undoes the last one
```

The tests use their own schemas of the same database: `TEST_DATABASE_URL` (default: the one above) and never `DATABASE_URL`.

To look inside the database (the container's user and password are `postgres`, the database is `coa`; a GUI such as DBeaver or TablePlus
connects the same way):

```bash
docker compose exec db psql -U postgres -d coa
```

`\dt public.*` lists `users`, `runs` and `alembic_version`, `\dt langgraph.*` the checkpoint tables, `\d runs` the columns. The JSON in
`runs` (`statuses`, `ui_spec`, `result`, `question`, `answer`) is stored as text: cast it to read it, for example
`select result::jsonb from runs`.

The model is reached through [OpenRouter](https://openrouter.ai/) (`openai/gpt-5-mini`). Put your key in
`backend/.env` (gitignored; loaded automatically with `python-dotenv`):

```
OPENROUTER_API_KEY=your-openrouter-api-key-here
WORKOS_CLIENT_ID=client_...   # the same client id as the frontend's; the API only accepts tokens signed for it
```

The API needs a signed-in person for everything under `/jobs`: the frontend sends the WorkOS access token as
`Authorization: Bearer ...` and the API checks it against WorkOS's public keys. Without `WORKOS_CLIENT_ID` it answers 503
instead of running open. `/health` needs no token, so `curl` the jobs endpoints below with a token from a signed-in session.

Each job records who uploaded it (`owner`, their sign-in id). The first time someone uploads, the API adds them to `users` (their sign-in id,
and their email and name when the access token carries them), and the job points to that row.

When an analysis finds a lot **non-conforming**, the API can mail
its summary (product, lot, supplier, test counts and a link to the job). Any SMTP provider works; add the settings to
`backend/.env`. Without `NOTIFY_EMAIL`, and either `SMTP_HOST` or `RESEND_API_KEY`, no mail is sent. `.env` is loaded when the API starts, so **restart the
API after changing it** (`fastapi dev` reloads on code changes, not on `.env`).

#### With Resend

[Resend](https://resend.com) needs no IP allow-list. In its dashboard, create an API key (*API Keys*, sending access):

```
SMTP_HOST=smtp.resend.com
SMTP_PORT=587                         # STARTTLS; the code does not speak port 465 (implicit TLS)
SMTP_USER=resend                      # always the word "resend"
SMTP_PASSWORD=re_...                  # the API key
SMTP_FROM=onboarding@resend.dev       # required: the login is not an address (see below for your own sender)
NOTIFY_EMAIL=you@example.com          # who gets the mails
APP_URL=http://localhost:3000         # optional: where the frontend is served; the mails then link to the job's page
```

`onboarding@resend.dev` is Resend's test sender: it only delivers to the address you signed up to Resend with. To send from your
own address and to anyone, verify a domain (*Domains → Add Domain*, then add the SPF and DKIM records it shows at your DNS
provider; a subdomain such as `alerts.example.com` keeps its reputation apart from your main mail) and change the sender:

```
SMTP_FROM=CoA Agent <coa-alerts@alerts.example.com>
```

#### Through Resend's HTTP API (hosts that block SMTP)

Some hosts block the SMTP ports (25, 465, 587): Render's free plan does since September 2025. Set `RESEND_API_KEY` and the mail goes
to Resend's HTTP API (HTTPS, port 443) instead; `SMTP_HOST`, `SMTP_USER` and `SMTP_PASSWORD` are then ignored.

```
RESEND_API_KEY=re_...                 # the API key (sending access is enough)
SMTP_FROM=onboarding@resend.dev       # optional: this is the default; the same sender rules as above apply
NOTIFY_EMAIL=you@example.com
APP_URL=https://your-frontend.example.com
```

A refused request is logged like any other failure, with Resend's reason (`Resend answered 403: ...`).

#### Other providers

Set `SMTP_HOST`, `SMTP_USER` and `SMTP_PASSWORD` to what the provider gives you for SMTP, and `SMTP_FROM` to a sender it has
verified whenever the login is not itself an address (Brevo's is not, for example; without `SMTP_FROM` the login is the sender).
`SMTP_PORT` defaults to 587, and STARTTLS is used whenever `SMTP_USER` is set. Leave `SMTP_USER` out to send without
encryption or login, e.g. to a local mail catcher on `127.0.0.1:1025`.

A mail that cannot be sent never fails the job: it stays done, the worker keeps running, and the API logs one warning (from `react_agent.tools`):

```
the non-conforming mail was not sent: SMTPAuthenticationError: (525, b'5.7.1 Unauthorized IP address')
```

That example is Brevo refusing a login from an IP that is not on its allow-list (*Security → Authorized IPs*); a server needs
its own address added there. With Resend, the usual causes are a wrong API key (the login fails), a sender on a domain that is
not verified, or, from `onboarding@resend.dev`, a recipient other than your own address (the send is refused). To check the
settings without running the agent, connect, `starttls()`, `login()` and send one message with `smtplib` using the values from
`.env`.

If the mail comes from the wrong provider, the API is still running with the settings it had when it started: restart it.

Every setting, for reference (the backend reads the environment and `backend/.env`; the frontend reads `frontend/.env.local`):

| Variable | Where | Meaning |
|---|---|---|
| `OPENROUTER_API_KEY` | backend | required: the model is reached through OpenRouter |
| `WORKOS_CLIENT_ID` | backend, frontend | required: the same value in both; without it the API answers 503 |
| `MAX_CONCURRENT_RUNS` | backend | worker threads, default 3 |
| `MAX_UPLOAD_MB` | backend | largest upload accepted, default 20; the request needs a `Content-Length` |
| `MAX_ACTIVE_JOBS_PER_USER` | backend | queued or running jobs one person may have, default 20; more are refused with 429 |
| `RATE_LIMIT` | backend | requests one address may make to the jobs routes (not `/health`), default `60/minute`; more are refused with 429. The counts are kept in memory, per process |
| `DATABASE_URL` | backend | required: the Postgres (with pgvector) that holds the `users` and `runs` tables and the agent's checkpoints |
| `EMBEDDING_MODEL` | backend | the model, through OpenRouter, that embeds the answers people give the agent (kept in the vector store, see Memory); it must return 1536 dimensions, default `openai/text-embedding-3-small` |
| `MEMORY_MIN_SCORE` | backend | how similar (0 to 1) an earlier answer must be to be offered to a person, default 0.8 (calibrated for the default embedding model) |
| `CHECKPOINT_SCHEMA` | backend | the schema of the agent's checkpoint tables, default `langgraph` |
| `TEST_DATABASE_URL` | tests | the Postgres the tests create their schemas in, default `postgresql://postgres:postgres@localhost:5432/coa` |
| `JOBS_DIR` | backend | where the uploaded PDFs (`uploads/`) live, default `backend/data/` |
| `CORS_ORIGINS` | backend | allowed browser origins, comma-separated, default `http://localhost:3000` |
| `BACKEND_PORT`, `FRONTEND_PORT`, `DB_PORT` | docker compose | the host ports of the containers, default 8000, 3000 and 5432 |
| `LANGSMITH_TRACING`, `LANGSMITH_API_KEY`, `LANGSMITH_ENDPOINT`, `LANGSMITH_AGENT_ID`, `LANGSMITH_AGENT_ENVIRONMENT` | backend | optional: send a trace of every run to LangSmith, see [Tracing](#tracing-langsmith) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`, `NOTIFY_EMAIL`, `APP_URL` | backend | the non-conforming mail over SMTP, see above |
| `RESEND_API_KEY` | backend | send the non-conforming mail through Resend's HTTP API instead of SMTP, for hosts that block SMTP; see above |
| `WORKOS_API_KEY`, `WORKOS_COOKIE_PASSWORD`, `NEXT_PUBLIC_WORKOS_REDIRECT_URI` | frontend | WorkOS AuthKit (the cookie password is 32+ characters) |
| `NEXT_PUBLIC_API_URL` | frontend | the API's address, default `http://localhost:8000` |

### Tracing (LangSmith)

Every run can be traced in [LangSmith](https://smith.langchain.com/): each graph step, each model call (prompt, reply, tokens, latency) and
each tool call, so you can see why the ReAct agent picked a tool, or what a prompt really sent. There is no tracing code: LangChain and LangGraph
read these variables, and the `langsmith` client comes in with `langchain-core`. Add them to `backend/.env`:

```
LANGSMITH_TRACING=true
LANGSMITH_API_KEY=lsv2_...                              # a LangSmith API key
LANGSMITH_ENDPOINT=https://eu.api.smith.langchain.com   # EU region; leave out for the US default
LANGSMITH_AGENT_ID=...                                  # the agent id from your LangSmith workspace
LANGSMITH_AGENT_ENVIRONMENT=local                       # labels where the traces come from (local, staging, ...)
```

- It is **off** unless `LANGSMITH_TRACING=true`; without the variables the app runs as before and sends nothing. `.env` is loaded when the
  API starts (and by `python -m agent.agent`), so restart after changing it.
- It applies to both implementations, the API's ReAct runs and the fixed graph's command-line runs.
- A job's id is its LangGraph `thread_id`, which LangGraph adds to a run's metadata, so look for a job's trace by that id.
- Traces hold the CoA text and the model's replies. Turn tracing off, or use a workspace the data may go to, when the certificates are confidential.

Run the fixed graph on the sample CoA, or on another PDF (the ReAct agent runs through the API):

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

Backend API (`GET /health`, `POST /jobs`, `GET /jobs`, `GET /jobs/{id}`, `GET /jobs/{id}/pdf`, `POST /jobs/{id}/answer`, `POST /jobs/{id}/decision`):

```bash
cd backend && .venv/bin/uvicorn main:app --reload
```

`POST /jobs` takes a PDF as multipart form data (field `file`), stores it and answers `202` with the new job. It refuses, before the job or the file is stored,
a body without a `Content-Length` (`411`) or over `MAX_UPLOAD_MB` (`413`, checked before the body is read), a file that does not start like a PDF (`415`), and a person who already has
`MAX_ACTIVE_JOBS_PER_USER` jobs queued or running (`429`); a run fails at its first step when the PDF has more than 30 pages. Every `/jobs`
route is also limited per client address to `RATE_LIMIT` requests (default `60/minute`, `/health` is never limited): more are refused with
`429`, before the sign-in is even checked. A run takes a minute or more, because the agent makes several model calls, so the work happens in the background: the
client polls `GET /jobs` (every job, oldest first, without the report) or `GET /jobs/{id}` (one job, with the report).
A job looks like this:

| Field | Meaning |
|---|---|
| `id` | the job id, which is also the agent's LangGraph `thread_id` |
| `filename` | the name of the uploaded file |
| `status` | `queued` (waiting for a worker), `running`, `needs_input` (the agent paused to ask a person), `done` or `error` |
| `owner` | the sign-in id of the person who uploaded it (a row of `users`); `null` for jobs from before owners were recorded |
| `question`, `answer` | what a paused agent asks (while `needs_input`) and the person's reply, as JSON; `null` otherwise |
| `statuses` | what the nodes reported, in order. Each node calls `_status(...)` first thing, which writes `{"status": ...}` with LangGraph's `get_stream_writer()`; the worker streams the graph in the `custom` stream mode and appends each one |
| `ui_spec` | the report, in `GET /jobs/{id}` only, once the job is `done`. The worker reads it from the run's checkpoint once the graph has finished, so only the report is copied into the job |
| `error` | why the job failed, when `status` is `error` |
| `started_at` | when a worker took the job, in milliseconds since the epoch |
| `finished_at` | when the job ended (done or error), in milliseconds since the epoch |
| `input_tokens`, `output_tokens`, `cost_usd` | what the run's model calls used (output tokens include reasoning) and what OpenRouter charged, in US dollars. Written when the job ends, from the totals in the run's state, so a failed job keeps what its calls before the failure cost; `null` for jobs from before this was recorded, and for a run that failed before its first call |
| `decision`, `decided_by`, `decided_at`, `reason` | a person's decision on the finished job (see below); all `null` until someone decides |
| `has_pdf` | whether the uploaded certificate is still stored, so `GET /jobs/{id}/pdf` has it (jobs from before the PDFs were kept do not) |
| `result` | what the job list shows without the report, once the job is done: `outcome` (Conforming, Needs review, Non-conforming or Not a CoA), `counts` of pass / fail / review, `product`, `lot`, `supplier`. Written by `write_summary`, or by `render_ui` for a document that is not a CoA |

How the queue works:

- `MAX_CONCURRENT_RUNS` (default 3) worker threads take job ids from an in-memory queue. The jobs themselves are rows in
  the Postgres `runs` table, and the uploaded PDFs are kept in `backend/data/uploads/` (set `JOBS_DIR` to move them): the certificate is the record a decision is about.
- The agent is compiled with a Postgres checkpointer (the `langgraph` schema) and run with the job id as its
  `thread_id`, so its state is saved after every step.
- When the API starts, jobs that were running (the process died) go back to the queue. A job whose run had passed some
  steps continues after the last finished one; one that had not starts over. Jobs are kept until you delete them from the database.
- A person can have at most `MAX_ACTIVE_JOBS_PER_USER` jobs queued or running; a job waiting for an answer does not count.
- The queue is per process: run one uvicorn worker.

The frontend shows the `statuses` in order and knows nothing about the graph. Tools the model does not call
(for example everything between `validate_document` and `render_ui` for a document that is not a CoA) send no status,
so they do not appear. `get_stream_writer()` only works inside a graph run, so the unit tests make it a no-op
(`tests/conftest.py`).

```bash
# TOKEN: a WorkOS access token from a signed-in session (without one the API answers 401)
curl -H "Authorization: Bearer $TOKEN" -F "file=@docs/sample_coa_defective.pdf" localhost:8000/jobs   # prints the job, including its id
curl -H "Authorization: Bearer $TOKEN" localhost:8000/jobs/<id>
```

### Answers

A run that flagged checks as unsure waits as `needs_input`, with its `question` (the checks and the earlier answers found in the memory).
`POST /jobs/{id}/answer` takes JSON `{"answers": {"<test>": "..."}, "by": "...", "remember": {"<test>": "product" | "global" | "none"}}`
and answers with the job, queued again. `409` when the job is not waiting (or someone answered first), `422` for a test that was not asked or a
blank `by`. A test left out or answered with a blank keeps the agent's verdict; one left out of `remember` is kept for the product's lots. `by` is
free text here too.

### Decisions

The agent only prepares the report; a person decides. `POST /jobs/{id}/decision` takes JSON
`{"decision": "approved" | "rejected" | "on_hold", "by": "...", "reason": "..."}` and answers with the job.

- A `reason` is required to reject or hold, and to approve a lot the agent did not find conforming (an override).
- `approved` and `rejected` are final (`409` afterwards); a lot `on_hold` can be decided again, and the new decision replaces the hold.
- Only a finished job can be decided (`409` before). The caller must be signed in, and the frontend sends the signed-in person's name as `by`, but the API does not check it: `by` is whatever the caller says, not tied to the signed-in id, so there is no e-signature and no audit trail, and a later decision replaces an earlier hold.

Frontend:

```bash
cd frontend && npm install && npm run dev
```

Sign in with WorkOS first: the frontend needs the `frontend/.env.local` variables above. Start the backend (see above) and the frontend, then click **Upload documents** and pick a CoA PDF
(for example `backend/docs/sample_coa_defective.pdf`). The report appears in the page after about two minutes. The
frontend calls `http://localhost:8000`; set `NEXT_PUBLIC_API_URL` to use another address.

When the API cannot be reached (or does not answer within 15 seconds) the page keeps what it shows, says so in a banner and tries again, waiting
longer after each failure. When it refuses the session (a `401` after a new token was asked for) the banner asks the person to sign in again and
polling stops; a half-typed answer is not lost, because nothing redirects until they press the button.

The component list in `RENDER_UI_PROMPT` (`backend/react_agent/prompts.py`, copied in `backend/agent/prompts.py`) and the catalog in
`frontend/components/report-renderer.tsx` must be kept in sync by hand.

## Testing

```bash
cd backend
docker compose -f ../docker-compose.yml up -d db   # the tests need a Postgres with pgvector (TEST_DATABASE_URL)
.venv/bin/python -m pytest -q           # unit tests, mocked model, no API key needed
.venv/bin/python -m scripts.eval_compare   # calls the real model on both sample CoAs, diffs the verdicts
```

The unit tests cover issue derivation, the retry and the fallback to `review`, the missing-spec routing, the job queue and
restart behaviour, the upload limits, the request rate limit, decisions, answers, the database (its tables, the migrations, the users), sign-in, and the mail (including the warning when it cannot be sent). The frontend has Vitest
tests for the components and helpers.
The eval script is slower (several model calls) and needs `OPENROUTER_API_KEY`. It exits non-zero if any
verdict differs from the expected one. It covers the one-page conforming sample and the defective one, not the three-page sample.

### Evaluating the ReAct agent (`backend/evals/`)

The unit tests mock the model, so they say nothing about whether the agent, with the real model, picks the right tools and reaches the right
verdicts. That is what the evaluation checks. `scripts/eval_compare.py` does it for the fixed graph (two PDFs, the verdicts diffed by hand);
the ReAct agent, which the API runs, is evaluated with [Ragas](https://docs.ragas.io), following its
[agent tutorial](https://docs.ragas.io/en/stable/tutorials/agent/).

**What Ragas is here.** Ragas is a Python library for evaluating LLM applications: you give it a dataset of rows, an `@experiment()` function that
runs your application on one row, and metrics that score what came back, and it runs every row (in parallel), keeps the results and gives them
back as a table. It also ships LLM-judged metrics (faithfulness, answer relevance, ...); **this evaluation uses none**. The agent's work has
a known right answer (the outcome, the verdicts, the tools), so the four metrics are plain Python functions wrapped with Ragas'
`@numeric_metric`, which gives each score a `value` and a `reason`. The scores are exact and free, and a wrong one never comes from a
second model's opinion.

| File | What it holds |
|---|---|
| `evals/scenarios.py` | The dataset: nine scenarios, each a PDF and what a correct run ends with |
| `evals/metrics.py` | The four metrics |
| `evals/run.py` | The `@experiment()`: runs the agent on each scenario, scores it, writes the results |
| `evals/docs/` | The extra PDFs the scenarios need (the samples in `backend/docs/` are reused) |

**The scenarios.** Each one has an expected `outcome`, the expected `verdicts` per plant test (a test not listed should pass; `None` when nothing
should be compared), the `tools` in the order they should be called, whether the quality team is mailed (`mails`) and, when the run
should pause on a check it is unsure of, the `answers` a person would give.

| Scenario | The document | A correct run |
|---|---|---|
| `conforming`, `conforming_3_pages` | the clean samples (one and three pages) | Conforming |
| `at_the_limits` | every result is exactly the plant's limit | Conforming (limits are inclusive) |
| `defective` | five seeded defects, among them a result the supplier's own status hides (water 0.45 against the plant's 0.4) and a missing row | Non-conforming, mailed; the appearance is answered, the lead result left unanswered stays `review` |
| `unclear_units` | water in `g/100 g` and lead in `ppb`, the plant uses `%` and `ppm` | pauses, a person settles both, then Conforming |
| `unknown_product`, `no_product_code` | no plant specification for the product | Non-conforming, nothing compared, mailed |
| `invoice`, `scanned` | not a CoA, and a PDF with no text layer | Not a CoA, straight to the report |

**The metrics.** Each returns 0 or 1, except `verdict_accuracy`, which is a share:

| Metric | 1 when |
|---|---|
| `outcome_correct` | the run ended with the expected outcome |
| `verdict_accuracy` | the share of the plant's tests with the expected verdict (1 when nothing should be compared and nothing was) |
| `mail_correct` | the quality team was mailed exactly when expected: for a Non-conforming lot only |
| `tools_correct` | the agent called exactly the expected tools, in that order (a call a tool refused counts) |

**Running it.** It calls the real model through OpenRouter (`OPENROUTER_API_KEY`), which costs about two to three cents for each scenario with a
plant specification (three for `defective`), a little over one for the two without, and a tenth of a cent or less for the two non-CoAs, so nine
scenarios cost about 16 cents:

```bash
cd backend
uv pip install --python .venv/bin/python -r requirements-eval.txt --overrides requirements-eval-overrides.txt   # once
.venv/bin/python -m evals.run
```

Each scenario is run as the API would run it: with its own in-memory checkpointer, the same recursion limit, and, when the agent pauses,
a resume with the scenario's `answers`. The run is isolated from the rest of the setup: the mail is stubbed (`notify.send_mail` returns
true, which the tool reports as "sent" and the mail metric reads), the memory of earlier answers finds and keeps nothing, and the
LangSmith traces and Ragas' usage statistics are off. A run that fails counts as a result (its `error` is recorded) and does not stop the
others.

**The results.** Ragas saves every row in `evals/results/experiments/<time>.csv`. `evals/results/<time>.xlsx` (both gitignored) has a
**Summary** sheet with the mean of each score per scenario and a **Runs** sheet with every row: the outcome, the tools called, the reason
of the verdict score, the cost and the error. Set `REPEATS` in `run.py` to run each scenario more than once: the model's answers vary,
so one run is an anecdote, and a mean over several shows how stable a scenario is.

One run (the same nine scenarios, `gpt-5-mini`) scored 1 for the outcome, the verdicts and the mail on all nine. `tools_correct` was 0 on
four of them: on the conforming lots (`conforming`, `conforming_3_pages`, `at_the_limits`, `unclear_units`) the model also called
`notify_quality_team`, which the system prompt says is only for a non-conforming lot. The tool refuses to mail anything else, so no mail
was sent and `mail_correct` stayed 1; `tools_correct` is the metric that shows the model ignoring its prompt, and it is why the
mail is a guarded tool and not a rule in the prompt.

## Continuous integration

GitHub Actions run on every pull request and on pushes to `main` (`.github/workflows/`). Each workflow only runs when
its own folder changes. The backend's tests run against a Postgres service container (`pgvector/pgvector`). The same steps run locally:

| | Backend (`backend/`, Python 3.14) | Frontend (`frontend/`, Node 24) |
|---|---|---|
| Format | `.venv/bin/ruff format .` | `npm run format` |
| Lint | `.venv/bin/ruff check .` | `npm run lint` (Biome) |
| Build | `python -m compileall -q . && python -c "import main"` | `npm run build` (also type-checks) |
| Test | `.venv/bin/python -m pytest -q` (needs the Postgres above) | `npm test` (Vitest) |

## Known limitations

- `pypdf` only reads text-based PDFs; scanned CoAs would need OCR.
- The model's output casing varies between runs (for example the supplier name is sometimes printed in capitals);
  values are copied from the document, not normalised.
- Numeric comparison is done by the model. The retry and the eval script exist to guard it; doing the numeric
  tests in Python and sending only qualitative rows to the model is a possible next step.
- Test names on the CoA must match the plant specification exactly; there is no fuzzy matching yet.
- The ERP's `approved_suppliers` and `min_remaining_shelf_life_days` are never read, so an unapproved supplier or a lot with
  too little shelf life left still comes out as conforming. Only the test table is compared.
- Everything signed in sees everything: each job records its `owner`, but the API does not filter or check it, so any
  signed-in person can list every job, open its PDF and decide it. `by` on a decision and an answer is free text: the frontend fills it with the signed-in person's name, but the API does not check it.
- `users` has the sign-in id, and the email and name only when the access token carries them, so those can be empty. Nothing else reads the table yet: `decided_by` and `by` stay free text, not a link to a user.
- Uploads are limited (size, PDF only, jobs in progress per person, 30 pages), and the active-jobs count is checked before the job is added, so a burst of simultaneous uploads can overshoot it slightly.
- The request rate limit counts per client address as the API sees it, in memory and per process: behind a reverse proxy every request comes from the proxy's address and shares one count, and a restart resets the counts.
- The API applies the migrations when it starts, which is safe for one process. With several, apply them first (`alembic upgrade head`) instead of letting them race.
- The queue is in memory and per process, and the API must run as one uvicorn worker. Jobs live in the database and the uploads in
  `backend/data/`, with no cleanup; the uploads are on the API's disk, not in the database.
- With LangSmith tracing on, the CoA text and the model's replies leave the machine for LangSmith, and nothing marks which traces belong to a
  job beyond its `thread_id`; the job and the UI do not link to them.
- The agent's checkpointer keeps one Postgres connection: after the database restarts, restart the API too.
- The model calls have no timeout of their own (the OpenAI client's default is ten minutes, with two retries), so a model that hangs holds a worker.
- The mail's STARTTLS does not verify the server's certificate, and a failed job's `error` is the raw exception text, shown to every signed-in person.
- A failed mail is only a log line; nothing on the job or in the UI says that the notification was not sent.
- Backend dependencies in `requirements.txt` are not pinned (only `PyJWT` has a floor), so installs are not reproducible.
- `npm audit --omit=dev` reports 7 high-severity findings, all through `shadcn` (a CLI that is listed as a runtime
  dependency, via `fast-glob` / `micromatch` / `braces`), not through code the app runs.
- The report UI is written by the model, so values in it are retyped by the model. The verdicts and issues stay in state
  from `compare_specs`; the page is a display layer. The frontend validates the spec against its catalog before rendering.
