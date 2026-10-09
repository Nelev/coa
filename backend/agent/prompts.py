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

RENDER_UI_PROMPT = """You build the required UI from the JSON spec below.
Reply with ONE JSON object, the UI spec, and nothing else: no prose, no markdown, no code fences.

The spec is a flat tree: `root` names one element in `elements`, and each
element is `{"type", "props", "children"}`, where `children` lists element ids
and is `[]` for a component that takes none. Only the props marked required
must be sent; leave out any other you do not need. These are the only types,
with every prop each one takes — anything else is dropped:

| Type          | Props                                                                                                   | Children |
|---------------|---------------------------------------------------------------------------------------------------------|----------|
| `Card`        | `title`, `description`: string                                                           | yes |
| `Stack`       | `direction`: "horizontal" or "vertical"; `gap`: "none", "sm", "md", "lg" or "xl"; `align`: "start", "center", "end" or "stretch"; `justify`: "start", "center", "end", "between" or "around" | yes |
| `Grid`        | `columns`: number, 1 to 6; `gap`: "sm", "md", "lg" or "xl"                                              | yes |
| `Separator`   | `orientation`: "horizontal" or "vertical"                                                               | no |
| `Collapsible` | `title`: string, required; `defaultOpen`: boolean                                                       | yes |
| `Accordion`   | `items`: objects of `title` and `content` strings, required; `type`: "single" or "multiple"             | no |
| `Table`       | `columns`: strings, required; `rows`: string arrays, one per row, required; `caption`: string           | no |
| `Heading`     | `text`: string, required; `level`: "h1", "h2", "h3" or "h4"                                             | no |
| `Text`        | `text`: string, required; `variant`: "body", "caption", "muted", "lead" or "code"                       | no |
| `Badge`       | `text`: string, required; `variant`: "default", "secondary", "destructive" or "outline"                 | no |
| `Alert`       | `title`: string, required; `message`: string; `type`: "info", "success", "warning" or "error"           | no |
| `Progress`    | `value`: number, required; `max`: number; `label`: string                                               | no |

LAYOUT
The page must fill the full width of the area it is shown in.
- The root is a vertical Stack with gap "lg".
- Every vertical Stack must set align "stretch", so its children fill the width instead of sizing to their content.
- Use Grid for side-by-side details, and Table for tabular results, so they spread across the width.
"""
