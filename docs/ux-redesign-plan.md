# New look and feel: UX and accessibility plan

Scope: the Next.js frontend in `frontend/`. Written against the code as of this change; the sign-in page (phase 0) is already built.

## 1. Where we are

**Already good, keep it.** Status never relies on color alone (icon + label in `status-chip.tsx`). The dark palette is contrast-tested (`lib/contrast.test.ts`, AA 4.5:1). Runs finishing are announced (`live-announcer.tsx`). The list is keyboard-navigable (`j`/`k`). Counts double as filters. Uploads work by drop anywhere. Motion respects `prefers-reduced-motion` in the places that animate. The release decision stays with a person.

**Gaps found in the code.**

| Area | Gap | Principle it breaks |
|---|---|---|
| Shell | No skip link; no `<nav>`; the user is only a "Sign out" text button (no identity shown); the 160px upload button crowds the header on phones | WCAG 2.4.1, orientation, recognition over recall |
| Theme | Dark only, no light or system option; the light tokens in `:root` are shadcn defaults and untested | WCAG 1.4.x, user control, glare in bright plants |
| Overview | Five equal-weight tiles; the rows are a `<ul>` of grids, so "file / verdict / when" has no column headers for screen readers | Hierarchy, WCAG 1.3.1 |
| Overview | Sort is a native `<select>` in a different visual language than the rest; no density or column choice | Consistency |
| Run page | The decision (the point of the page) sits below the whole report; a long report pushes it off screen | Fitts / visibility of the main action |
| Decision | Reject and Hold commit on one click, with no confirmation or undo | Error prevention, WCAG 3.3.4 for consequential actions |
| Feedback | Failures are inline paragraphs only; no toast or undo pattern for upload, decision, errors | Visibility of system status |
| Tokens | Spacing, type, radius and motion are ad hoc utility classes (cards use `rounded-xl`, controls `rounded-lg`, a `--radius` token sits unused between them) | Consistency, maintainability |
| Touch | `icon-xs` is 24px (the WCAG 2.2 minimum); the row actions and neighbour arrows are 32px | WCAG 2.5.8 (target size), comfortable on tablets |

## 2. Design principles

1. **Triage first.** The first screen answers "what needs me?", not "what exists?". Needs attention is the loudest thing on the page.
2. **Color is a second channel, never the only one.** Every state keeps icon + label + color.
3. **The agent proposes, a person decides.** Decision UI is calm, explicit and reversible where possible.
4. **Quiet chrome, loud data.** Neutral surfaces; the semantic colors (pass, review, fail) are the only saturated things in the app. The login background is the one place the brand color gets to perform.
5. **Motion explains, never decorates, inside the app.** Decorative motion lives on the login page only and always has a still fallback.
6. **Works with keyboard, screen reader, touch and 200% zoom** as a first-class path, not a retrofit.

## 3. Foundations (tokens first, then screens)

All of it lives in `app/globals.css` as CSS variables, so a screen redesign is a token change plus a few class swaps.

- **Color.** Keep the slate-indigo neutrals. Add a light theme and a `system` default with a header toggle (`light | dark | system`, stored in a cookie so the server renders the right theme, no flash). Semantic roles: `success`, `warning`, `destructive`, `info`, each with a `-subtle` background and a `-foreground` text role. Extend `contrast.test.ts` to run on both themes and to cover the subtle backgrounds. Non-text UI (borders of inputs, focus ring) must reach 3:1.
- **Type.** Geist stays. A fixed scale: `xs 12 / sm 14 / base 16 / lg 18 / xl 20 / 2xl 24 / 3xl 30`; body 14 in dense tables, 16 for prose; `tabular-nums` for every count, lot and date; `text-balance` on headings, `text-pretty` on paragraphs. Minimum 12px, never below.
- **Space and shape.** 4px grid; page gutters 16/24/32 by breakpoint; two radii only (`--radius-control` 8px for inputs and buttons, `--radius-surface` 14px for cards and panels); elevation by surface lightness first, shadow only for overlays.
- **Focus.** One focus style everywhere: 2px ring in `--ring` with a 2px offset against the surface, never removed. Keep `focus-visible` so mouse users do not see it.
- **Motion.** Tokens `--dur-fast 120ms`, `--dur-base 200ms`, `--dur-slow 400ms`, one ease `cubic-bezier(.2,.7,.2,1)`. Only `transform` and `opacity` animate. A global `@media (prefers-reduced-motion: reduce)` rule collapses durations to ~0 and removes translations.
- **Targets.** Minimum 40px tall for primary controls on touch, 24px absolute minimum with 8px spacing; rows are at least 56px tall.

## 4. Screens

**App shell.**
Skip link ("Skip to runs") as the first focusable element. A real `<nav aria-label="Primary">`. A user menu (avatar button, name and email, theme choice, sign out) using the existing `dropdown-menu`. Upload collapses to an icon button with a tooltip below `sm`, and a sticky bottom action on phones. The "N analyses running" text becomes a status pill in the header that links to the in-progress filter. Breadcrumbs on the run page (the component exists).

**Overview.**
The runs come first, with the segmented filters (counts, `aria-pressed`) above them: "Needs attention" is one of them and is the way to the runs that need a person. (An emphasized "Needs attention" card with a "Review now" button was built and then removed: it repeated what the filter already shows.) Render the runs as a real `<table>` (column headers, `scope`), collapsing to cards under 640px. Add sticky column headers, a density toggle (comfortable / compact) stored locally, and sort by clicking headers with `aria-sort`. Keep `j`/`k`, and add `/` to focus search and `?` for a shortcuts dialog. The empty state keeps the drop target, with a sample certificate link for first-time users.

**Run page.**
A summary header: product, lot, supplier, one large verdict chip, and the pass / review / fail counts as a three-segment bar (labelled, with the numbers). The decision panel becomes a sticky bar on desktop and a bottom sheet on mobile, so the action is always in reach. The report keeps the model-laid-out UI but inside a fixed max reading width and a consistent card grid; add "copy link to this finding" anchors. Activity tab: steps as an ordered list with `aria-current="step"` on the running one.

**Decision flow.**
Approve is one click when conforming. Reject and Hold open a confirmation dialog that restates the lot and the reason and has Cancel focused first. After submitting, a toast with Undo for 8 seconds (the server records on confirm, so Undo is a compensating "withdrawn" entry, to be designed with the backend). The reason textarea keeps its live hint; validation shows on submit, not while typing.

**Feedback and states.**
One toast region (`role="status"`, polite; errors `role="alert"`) for upload results, decisions and the offline banner recovery. Skeletons match the final layout (no layout shift). Every error says what happened, what is safe, and what to do (retry button). Offline banner stays but gets a Retry now button.

**Login (phase 0, done).** See section 6.

## 5. Accessibility checklist (WCAG 2.2 AA)

| Criterion | How we meet it |
|---|---|
| 1.3.1 Info and relationships | Real table for runs, `<nav>`, one `<main>`, headings in order, labelled form fields |
| 1.4.3 / 1.4.11 Contrast | Tested tokens in both themes; focus ring and input borders at 3:1 |
| 1.4.4 / 1.4.10 Resize, reflow | Layouts hold at 200% zoom and 320px width without horizontal scroll |
| 1.4.13 Content on hover or focus | Tooltips dismissible, hoverable, persistent (base-ui provides this) |
| 2.1.1 / 2.1.2 Keyboard | Everything reachable, no traps; dialogs trap focus and restore it on close |
| 2.4.1 / 2.4.7 Skip link, focus visible | Skip link, one consistent focus ring |
| 2.4.11 Focus not obscured | Sticky header and decision bar get `scroll-padding` so focused items are never hidden |
| 2.5.8 Target size | 24px minimum, 40px for primary touch controls |
| 3.3.1 / 3.3.4 Errors, prevention | Inline errors tied with `aria-describedby`; confirmation for reject and hold |
| 3.3.7 Redundant entry | The decision reviewer name is remembered |
| 4.1.3 Status messages | One live region for toasts and run completion (extends `LiveAnnouncer`) |
| Motion (2.3.3 AAA, adopted) | No parallax; decorative motion pauses and stills with `prefers-reduced-motion` |

## 6. Phase 0: sign-in page (built)

- **Route and flow.** `/login` is a branded page in a new `(auth)` route group; the app shell moved to `(app)` so the login page loads no header, no polling and no upload drop zone. `proxy.ts` now sends signed-out visitors to `/login?next=<page>` (instead of straight to WorkOS), and signed-in visitors on `/login` to where they were going. `/sign-in` still starts the WorkOS flow and now returns to `next`, validated by `lib/auth-redirect.ts` (same-site paths only; tested).
- **Why a card with one button.** The credentials form is WorkOS's hosted AuthKit page; we cannot put a background behind it from the app. The card is the in-app "front door" with a clear single action; the hosted form can be given the same look in the WorkOS dashboard branding settings (colors, logo, dark theme) so the hand-off is not jarring.
- **Background: a pharmaceutical line** (`components/login/`; redone after the first version, a generic network of dots). It is built from what the app is about, in two layers over a faint graph-paper grid and slow colored light:
  - **Inspection line** (`production-line.tsx`, canvas, along the foot): vials and flasks ride a conveyor through an inspection gate. A scan line climbs each one, and it leaves tagged PASS 99.7 %, REVIEW or FAIL 98.2 % (the same three verdicts as the app; mostly pass, sometimes review, rarely fail), its cap taking the verdict's color. A failed vial is blown off the line. The tag always says the word, so color is never the only signal.
  - **Molecules** (`molecule-field.tsx`, canvas behind): structural formulas (benzene, naphthalene, an aspirin-like acid, a citric-acid chain) drift and turn slowly, with N and O atoms in faint chemist's colors. They do not react to the pointer (an earlier version did, and moving the mouse made them shift and jump), and each one wraps around only once it is wholly off the screen.
  - The geometry and the logic are plain functions with tests (`lib/molecules.ts`, `lib/line-scene.ts`); the canvases share one loop (`use-scene.ts`).
- **The card** is a lab instrument: a flask mark with a pulsing status dot and "Batch release check", corner marks like the frame of a display, and a light that circles its edge.
- **Accessibility and performance of the background.** Everything is `aria-hidden`, `pointer-events: none` and never focusable. Reduced motion: the aurora and the card's light stop, and each canvas draws one still frame (and reacts live if the setting changes). The canvas loops pause while the tab is hidden, cap the time step so a returning tab does not jump, cap the pixel ratio at 2, and scale with the screen (fewer, smaller molecules and vials on a phone). The card is 90% opaque with a blur, so text contrast does not depend on what moves behind it. Nothing flashes, and nothing sweeps across the form: an earlier version had an HPLC trace across the top and a scan line down the card, and both were removed because they ran over the form.
- **Form details.** The button is a real link (not `next/link`, so it is not prefetched), shows "Taking you to sign-in…" with a spinner and a polite status message while the browser leaves, and resets on back-navigation (bfcache).

## 7. Phase 1 as built, and what it left for later

- **Theme.** `:root` is the light palette and `.dark` the dark one (both slate hue 265). A `theme` cookie holds `light`, `dark` or `system` (the default). A chosen theme is rendered by the server; `system` is settled by a one-line script before first paint, so there is no flash. The choice is in the user menu and follows the device live while "System" is on. The login page stays dark on purpose.
- **Tokens.** New `--field` (border of form controls, 3:1) now used by inputs, selects, the decision form and outline buttons; light-theme `success`, `warning`, `info`, `subtle-foreground` (they were dark-only before). One default transition duration and easing for all `transition-*`; one global reduced-motion rule; one fallback focus ring; `scroll-padding-top` for the sticky header; balanced headings. Buttons are 40px on coarse pointers.
- **Contrast test.** `lib/contrast.test.ts` now checks both themes, includes the status colors on their own 20% tint (as on badges), the labels on filled buttons, and 3:1 for field borders and the focus ring. It found real misses in the first light palette, which were fixed.
- **Shell.** Skip link to `#main`; `<nav aria-label="Primary">` with `aria-current`; a user menu (avatar, name and email, theme, sign out) replaces the bare "Sign out"; Upload is icon-only below `sm`.
- **Not done yet, deliberately.** Linking the "N analyses running" text to the in-progress filter needs the overview filter in the URL (phase 2). A type scale and the two-radius system are left out: Tailwind's own scale already is the fixed scale, and changing radii would touch every card, so it moves to the phase that redesigns the cards. Screens behind the sign-in were not checked visually in the browser (the review session had no WorkOS login); the new components were checked on a scratch page in both themes, and the pages compile and typecheck.

## 8. Phase 2 as built, and what it left for later

- **Filters first.** The five equal tiles became a segmented `FilterBar` with counts (`aria-pressed`; pressing the active one shows all again). A card on top that summed up what needs attention, with a "Review now" button to the most urgent run, was built and later removed: the "Needs attention" filter says the same and leads to the same runs.
- **A real table.** `RunsTable` / `RunRow` use `<table>` with column headers, a caption and `aria-sort`; the headers are sticky below the app header and sort on a press (Status = priority, File = A–Z / Z–A, Updated = newest / oldest). Only the file name is the link, and its `::after` covers the row, so a screen reader meets one link per row and the pointer gets the whole row as a target. On a phone the Result and Updated columns collapse under the file name (still one table, no duplicated list), and a Sort select takes over from the headers.
- **State in the address.** `/?filter=attention&sort=name` works and can be shared; the header's "N analyses running" now links to `/?filter=progress`. It changes with `history.replaceState` (no round trip to the server) and unknown values fall back to the defaults (`parseFilter`, `parseSort`, tested).
- **Keyboard.** `j` / `k` / Enter as before, plus `/` to search and `?` for a shortcuts dialog (also a button, for mouse users). The keys are off while typing in a field.
- **Density.** A "Compact" toggle tightens the rows for a mouse; it is stored in `localStorage` as a preference and ignored on touch screens, where rows keep their 40px+ height.
- **Empty state.** Besides the upload button it offers two sample certificates (`public/samples/`, copies of `backend/docs/sample_coa_*.pdf`) that upload with one click.
- **Dialog.** New `components/ui/dialog.tsx` (Base UI: focus trap, Esc, focus back to where it was). The exit animations of the dialog and the dropdown now hold their last frame (`fill-mode-forwards`), which removes a snap back to full opacity just before they unmount.
- **Known limits.** "Needs attention" still counts a lot a person has already rejected (it is the agent's verdict, not the person's). Whether to move decided lots out of that count is a product call. The 200% zoom and screen-reader passes are still manual, and `next build` was not run.

## 9. Phase 3 as built, and what it left for later

- **Summary header.** `RunSummary`: the lot is the page's one `h1` ("Citric Acid · Lot L26-09-3402"; the file name when the certificate does not say), then supplier and file name, a breadcrumb (Runs › lot), and a card with the verdict as a large chip, the decision chip, one sentence ("8 of 11 tests pass, 1 to review, 2 fail") and `VerdictBar`: the tests as a three-part bar with the counts beside it and one `role="img"` label for screen readers. A run still going shows its progress there instead.
- **Decision stays in reach.** From `lg` on, `DecisionPanel` is a column beside the report that sticks below the app header (so it is on screen while the report scrolls). Below `lg`, `DecisionBar` stays at the foot of the screen ("Waiting for your decision" and a Decide button, or the decision and a Details button) and opens the same form as a bottom sheet (`DialogContent variant="sheet"`, closed again when the decision is saved). `scroll-padding-bottom` keeps a focused element from sitting under the bar.
- **The report.** Alert, Heading and Table of the model's UI spec are drawn by us (`components/report-parts.tsx`) instead of json-render's: findings use the app's colors with an icon and a spoken "Error:" / "Warning:" prefix, and no longer carry `role="alert"` (a report of ten findings used to read all ten aloud when it loaded). The "Verdict" column of the test table gets an icon and a color beside its word. The report's own `h1` steps down to `h2` (the page has its own); nothing else in the spec is changed, and a layout that does not match the prompt simply gets no extra links. The report is held to a reading width (`max-w-4xl`).
- **Links to findings.** Each issue and each test row has a "Copy link" button (hover, focus, always on touch) that puts `#issue-assay-anhydrous-basis` or `#test-water-karl-fischer` in the address bar and on the clipboard; opening such a link scrolls to the finding and outlines it, even though the report loads after the page. A finding whose words occur twice gets no link (an id must be unique), so no link ever points at the wrong one. See `lib/anchors.ts`.
- **Activity.** The steps are a timeline: the running step is `aria-current="step"`, and every step says its state in words ("done", "in progress", "failed") as well as by its icon.
- **Structure.** `RunPage` fetches; `RunView` shows (so the page can be rendered with fixtures).
- **Left for later.** The report still opens with its own title, subtitle and verdict, which the summary now repeats; removing sections 1–3 from the report prompt (`RENDER_UI_PROMPT`) would fix that for new runs, but reports already stored would keep them, so it needs a decision on the backend side. "Copy link" shows its confirmation as an icon and a spoken "Link copied"; a toast with Undo comes with phase 4. The Report tab's cards (Material, Certificate and shipment) are still json-render's.

## 10. Phase 4 as built, and the decision about Undo

**Undo was dropped on purpose.** The server stores one decision per lot with no history, and approved or rejected is final by design. A real Undo needs either a "withdraw" call and an audit rule (a backend and compliance decision), or a delayed save, which can silently lose a decision if the tab closes in the delay. The chosen design is the safer one for a release record: ask first, then say what was recorded. The "toast with Undo" of section 4 is replaced by a toast without it.

- **Confirm before what cannot be taken back.** Approving a conforming lot is still one click. Rejecting, holding, and approving a lot the agent did not find conforming ("Approve anyway") open an `alertdialog` that says back the lot, what the agent found, who is deciding and the reason, and how final it is (`lib/decisions.ts`). "Cancel" has the focus, the backdrop does not dismiss it, and while the request is out the buttons are held and say "Recording…". A refused request is shown inside the dialog and says nothing was recorded.
- **Validation on submit.** No button is greyed out any more. Pressing one that needs a reason (reject, hold, override) focuses the field, outlines it, and says "Add a reason to reject this lot." beside it (`aria-invalid`, `aria-describedby`); typing clears it. The reviewer's name is remembered between visits (WCAG 3.3.7).
- **Toasts.** `ToastProvider` is the one place for what the app tells you: a decision was recorded ("Lot rejected · Citric Acid · Lot L1 · recorded as QA Anna"), how an upload batch went, files that were skipped, the server is back. It replaces the notice banner. Success and info go by after 6s, warnings after 9s, errors stay until dismissed; hovering or focusing a toast holds its timer (WCAG 2.2.1). Errors are `role="alert"`, the rest `role="status"`; at most four are shown (an error is the last to be dropped). On a phone they rise above the decision bar.
- **Offline.** `OfflineBanner` is on every page, says the data may be old and nothing is lost, and has a "Retry now" button (it asks at once instead of waiting for the growing back-off). When the server answers again, a toast says so.
- **Errors say what to do.** A report that cannot be loaded has "Try again" and says the analysis is saved; a run that failed has "See the steps"; an upload that failed stays in the list with "Try again" (the file is kept in memory) and "Remove". The upload toast says what failed, that nothing was lost, and how many did go through.
- **Skeletons** now have the shape of what they stand for (filters, search and rows; report title, verdict, cards and findings; run header), announce "Loading…" and mark `aria-busy`.
- **Left for later.** The reviewer is still a choice of two demo names, not the signed-in person (the backend takes `by` as given; tying it to the WorkOS user is a backend change). Toasts do not yet have an action button because nothing needs one now. Undo can come back if the backend gets a withdraw call.

## 11. Performance pass (React best practices)

Measured with a production build (`next build`, which had not been run before this pass and passes). Client JavaScript, gzipped, all chunks: **438 kB → 365 kB**.

- **The report chunk, 128 kB → 56 kB.** It is loaded on demand when a report opens, but it carried all of `@json-render/shadcn`: one object of some forty components with Radix, a carousel and a drawer, so importing one loads every one. The report uses twelve; we already drew three of them. The other nine (Stack, Grid, Card, Separator, Collapsible, Accordion, Text, Badge, Progress) are now ours (`components/report-parts.tsx`, native `<details>` for the collapsibles, no script). json-render still supplies the catalog, so what a report may contain and how it is checked is unchanged. `components/report-renderer.test.tsx` renders a spec with every component type through that catalog.
- **Loaded when first needed:** the shortcuts dialog, the decision confirmation and the decision sheet (each is a dialog, loaded the first time it is asked for and then kept mounted so it can close with its animation), and, on the login page, the two canvas layers (after the form, browser only).
- **Typing in the overview's search stays responsive** (`useDeferredValue`: the filtering follows a moment behind the field).
- **React Compiler stays effective.** Three components wrote to a ref while rendering, which makes the compiler skip them; they use state set during render instead. The keyboard handler no longer re-subscribes on every render.
- **Checked and fine as they were:** requests already run in parallel (the layout reads the session and the cookie together, a report is asked for as the page opens); `@base-ui` and the UI components are imported by path, and Next optimizes `lucide-react` imports; the conditional renders use booleans, not numbers; sorts work on copies.
- **Not done:** the zod schemas of all forty upstream definitions still ship in the report chunk (they come from `@json-render/shadcn/catalog` as one object; trimming them means writing our own schemas, and a mistake there would reject valid reports).

## 12. Cleanup pass

A review of the whole change for reuse, simplification, efficiency and altitude, and what it led to:

- **One of each, not several.** A `Problem` box (errors in forms, dialogs, the report page and the offline banner), a `SkeletonRegion`, a `TONE` table (toasts and report findings), `resultSentence` (what the agent found, in words), `missingReason`, and three small hooks: `usePersistedChoice` (reviewer, row density), `useOnceOpened` (a dialog is mounted after it is first opened, so it can animate closed) and `useMediaQuery`.
- **A row renders its outcome once.** On a narrow screen the table's Result and Updated columns are not mounted at all (it was a hidden copy before), so a running run has one progress bar and one timer, and a failed upload one pair of buttons. The elapsed timer ticks once a second after the first minute. Failed uploads' files are kept in a ref, not in the list's state, so Try again and Remove keep a stable identity.
- **Less work per frame on the login page.** The gate's gradients are built once and tag widths are measured once; the molecules are drawn as one path each, from precomputed styles and positions; the loop caps the molecule layer at 30 fps, does not build the scene twice on mount, and does not rebuild it when the size has not changed. The card no longer blurs a moving background (it is 95% opaque).
- **Fixed at the root instead of per component.** The exit-animation fix is one rule in `globals.css` (`[data-closed]`), not an edit in each of the generated dialog and menu files; the report's grid stacks on a phone by its own classes, not by a global selector on class-name fragments; `Button`'s `lg` size is 40px, so callers no longer override it.
- **Left as they are, on purpose.** The decision UI exists twice by viewport (a column and a sheet) and is not folded into one component; `RunView` stays separate from `RunPage` (it is what makes the page renderable with fixtures); the `html:has([data-decision-bar])` offsets stay; the focus-ring class strings stay (some elements need a ring, not the outline); the list of runs is still fetched whole once a second while anything runs (making it incremental is a backend change).

## 13. Rollout

| Phase | Content | Done when |
|---|---|---|
| 0 | Sign-in page, route groups, proxy (this change) | Merged; WorkOS sign-in still returns to the requested page |
| 1 | **Built.** Tokens: light and system theme, focus, motion; contrast test on both themes; skip link, `<nav>`, user menu | Contrast tests green in both themes; axe finds no serious issue on `/` and `/runs/[id]` (the axe run waits for the Playwright setup in the testing line below) |
| 2 | **Built.** Overview: segmented filters, real table, density, shortcuts dialog | Screen reader announces columns and sort; works at 320px and 200% zoom (checked by layout at 375px; the screen reader and zoom passes are still manual) |
| 3 | **Built.** Run page: summary header, decision beside the report (a sheet on phones), finding links, steps timeline | Decision reachable without scrolling on a 700px-high viewport (checked at 1280×700) |
| 4 | **Built.** Decision confirmation, toasts, error and offline patterns (no Undo: see section 10) | Keyboard-only run through upload → review → reject, no dead ends (checked by hand in the browser; the screen-reader run is still manual) |

**Testing for every phase.** `vitest` for logic (tokens' contrast, `safeReturnPath`, sort and filter). Add Playwright with `@axe-core/playwright` for `/login`, `/`, `/runs/[id]` in light and dark, desktop and 375px, with `reducedMotion: "reduce"` as one variant. Manual: keyboard-only pass, VoiceOver or NVDA on the decision flow, 200% zoom, and a low-end laptop check of the login animation (target: steady 60fps, under ~5% CPU when idle).
