# Prompts of the model-driven nodes: validate_document, get_document_data, compare_specs and render_ui.

VALIDATE_PROMPT = (
    "Decide whether the document below is a supplier Certificate of Analysis (CoA): a certificate issued by a "
    "manufacturer or supplier for one lot of a material, with product and lot identification and a table of "
    "analytical test results.\n"
    "- Invoices, purchase orders, safety data sheets, technical data sheets, brochures and unrelated documents "
    "are not CoAs.\n"
    "- A CoA with missing or failing results is still a CoA; judge the kind of document, not its quality.\n\n"
    "Document:\n"
)

EXTRACTION_PROMPT = (
    "You are reading a supplier Certificate of Analysis (CoA). Extract its data exactly as written.\n"
    "- Copy values verbatim; never infer, correct, convert or round them.\n"
    "- Use null for anything the document does not state.\n"
    "- Every row of the analytical results table is one test; do not mix header fields into the tests.\n\n"
    "Document:\n"
)


COMPARE_PROMPT = (
    "You are an incoming-quality-control reviewer at a plant. Compare the results on a supplier "
    "Certificate of Analysis with the PLANT requirements for the material. Judge against the plant "
    "requirements only, never against the supplier's own limits.\n"
    "- Return exactly one check for every test in the plant requirements, using its test name verbatim.\n"
    "- Limits are inclusive: a value equal to a limit passes.\n"
    "- A result written as '< x' passes a max limit only if x <= max. Against a min limit it cannot be "
    "confirmed, so the verdict is review.\n"
    "- If the CoA unit differs from the plant unit, the verdict is review. Never convert units silently.\n"
    "- Qualitative tests pass only if the CoA result is one of the accepted words (case-insensitive). "
    "Any other result is review, never an assumed pass.\n"
    "- A plant-required test that is not reported on the CoA is fail, with the reason 'not reported'.\n"
    "- Ignore CoA tests that the plant does not require.\n"
    "- Quote numbers verbatim in the reason; never round or restate them. For fail and review, say in "
    "the same sentence why (e.g. 'exceeds the maximum', 'below the minimum', 'not an accepted result').\n"
    "- Verdicts: pass = meets the requirement; fail = clearly violates it or is missing; "
    "review = cannot be decided automatically.\n\n"
)

RENDER_UI_PROMPT = """You build the report page for an incoming-quality-control review of a supplier Certificate of Analysis (CoA).
Reply with ONE JSON object, the UI spec, and nothing else: no prose, no markdown, no code fences.

SPEC FORMAT
{"root": "<element key>", "elements": {"<element key>": {"type": "<component>", "props": {...}, "children": ["<element key>", ...]}}}
- Every element needs "type", "props" and "children". Leaf elements use "children": [].
- Every key listed in a "children" array must be defined in "elements". Keys are unique.
- Use only the components below, and only the props listed for them. Optional props can be left out.
- Write every value as a plain string; do not use expressions or placeholders.

AVAILABLE COMPONENTS
- Stack: {direction?: "horizontal"|"vertical", gap?: "none"|"sm"|"md"|"lg"|"xl", align?: "start"|"center"|"end"|"stretch", justify?: "start"|"center"|"end"|"between"|"around"}. Flex container, has children.
- Grid: {columns?: number, gap?: "sm"|"md"|"lg"|"xl"}. Grid layout, has children.
- Card: {title?: string, description?: string}. Bordered section, has children.
- Separator: {orientation?: "horizontal"|"vertical"}. Divider line.
- Heading: {text: string, level?: "h1"|"h2"|"h3"|"h4"}.
- Text: {text: string, variant?: "body"|"caption"|"muted"|"lead"|"code"}.
- Badge: {text: string, variant?: "default"|"secondary"|"destructive"|"outline"}. Short status label.
- Alert: {title: string, message?: string, type?: "info"|"success"|"warning"|"error"}. Banner.
- Table: {columns: string[], rows: string[][], caption?: string}. Every row has one string per column.

HOW TO BUILD THE PAGE
The root is a vertical Stack (gap "lg"). Every vertical Stack must set align "stretch", so that its children fill the
width of the page instead of sizing to their content. In this order:
1. Title: a Heading with the product name and lot number, and a Badge for the outcome. The outcome is
   "Non-conforming" (destructive) if any issue has severity "critical", else "Needs review" (secondary) if there are
   any issues, else "Conforming" (default).
2. A Text (variant "lead") with the recommendation: for non-conforming, do not release the lot and quarantine it until
   QA decides; for needs review, hold the lot until QA has reviewed the flagged results; for conforming, the results
   meet the plant specification. Say that the release decision stays with QA.
3. A Card "Certificate" with the header details (certificate number, issue date, supplier, product code,
   manufacturing and expiry dates, PO number, lot and shipped quantity, customer), laid out in a Grid of Text elements.
   Skip any detail that is missing.
4. If there are issues: a Heading "Findings", then one Alert per issue, critical issues first (type "error"), then
   warnings (type "warning"). The Alert title is the test name; the message says what was reported and what the plant
   requires, and why it is flagged. If an issue has no test, use its message as the Alert title.
5. A Heading "Results against the plant specification" and a Table with the columns Test, Verdict, Reported, Plant
   requirement, in that order: one row per entry in "tests", with the verdict in capitals (PASS, FAIL, REVIEW) and
   "not reported" when there is no reported result.
6. A Text (variant "muted") saying that supplier approval and remaining shelf life were not assessed.

RULES
- Use only values from the data below. Copy numbers, units, limits and names exactly; never invent, round or convert.
- If there are no tests (for example because no plant specification was found), skip the table and show the issues.

DATA
"""
