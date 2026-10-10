import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Outcome, Run } from "@/components/report-context";
import { RunSummary, runTitle } from "@/components/run-summary";
import { Steps } from "@/components/steps";

const result = (outcome: Outcome, counts = { pass: 9, fail: 1, review: 1 }, extra = {}) => ({
  outcome,
  counts,
  product: "Citric Acid",
  lot: "L1",
  supplier: "Alpina",
  ...extra,
});
const base: Run = {
  id: "abc",
  filename: "coa.pdf",
  state: "done",
  startedAt: 1,
  finishedAt: 2,
  statuses: ["Reading the PDF", "Writing the report"],
  result: result("Non-conforming"),
};
const summary = (run: Partial<Run>) => renderToStaticMarkup(<RunSummary run={{ ...base, ...run }} actions={<button type="button">Open</button>} />);

describe("runTitle", () => {
  it("names the lot, or falls back to the file", () => {
    expect(runTitle(base)).toBe("Citric Acid · Lot L1");
    expect(runTitle({ ...base, result: result("Non-conforming", undefined, { product: null, lot: null }) })).toBe("coa.pdf");
    expect(runTitle({ ...base, result: undefined })).toBe("coa.pdf");
  });
});

describe("RunSummary", () => {
  it("makes the lot the page's one h1 and says what the agent found, in words and as a bar", () => {
    const html = summary({});
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toContain("Citric Acid · Lot L1");
    expect(html).toContain("Alpina · coa.pdf");
    expect(html).toContain("Non-conforming");
    expect(html).toContain("9 of 11 tests pass, 1 to review, 1 fail");
    expect(html).toContain('role="img"');
    expect(html).toContain("Open");
  });

  it("shows what a person decided next to the verdict", () => {
    expect(summary({ decision: "rejected", decidedBy: "QA Anna" })).toContain("Rejected");
  });

  it("has no bar for a document that is not a CoA", () => {
    const html = summary({ result: result("Not a CoA", { pass: 0, fail: 0, review: 0 }) });
    expect(html).toContain("This document is not a Certificate of Analysis.");
    expect(html).not.toContain('role="img"');
  });

  it("shows the progress while it is still running, with no verdict", () => {
    const html = summary({ state: "loading", result: undefined, startedAt: Date.now() });
    expect(html).toContain("Analyzing");
    expect(html).toContain("Step 2");
    expect(html).not.toContain('role="img"');
  });
});

describe("Steps", () => {
  it("marks the step that is going on, and says each state in words", () => {
    const html = renderToStaticMarkup(<Steps run={{ ...base, state: "loading" }} />);
    expect(html.match(/aria-current="step"/g)).toHaveLength(1);
    expect(html).toContain('Reading the PDF<span class="sr-only"> (done)</span>');
    expect(html).toContain("(in progress)");
  });

  it("marks no step as current once the run is over", () => {
    const html = renderToStaticMarkup(<Steps run={base} />);
    expect(html).not.toContain("aria-current");
    expect(renderToStaticMarkup(<Steps run={{ ...base, state: "error" }} />)).toContain("(failed)");
  });
});
