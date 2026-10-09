import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Run } from "@/components/report-context";
import { RunRow } from "@/components/run-row";
import { StatusChip } from "@/components/status-chip";

const NOW = 1_000_000;
const base: Run = { id: "abc", filename: "coa.pdf", state: "done", startedAt: 1, finishedAt: NOW - 120_000, statuses: [] };
const result = (overrides = {}) => ({
  outcome: "Non-conforming" as const,
  counts: { pass: 9, fail: 1, review: 1 },
  product: "Citric Acid",
  lot: "L1",
  supplier: "Alpina",
  ...overrides,
});
const row = (run: Partial<Run>) => renderToStaticMarkup(<RunRow run={{ ...base, ...run }} now={NOW} />);

describe("StatusChip", () => {
  it.each([
    [{ state: "queued" }, "Queued"],
    [{ state: "loading" }, "Analyzing"],
    [{ state: "error" }, "Failed"],
    [{ state: "done" }, "Check report"],
    [{ state: "done", result: result({ outcome: "Conforming" }) }, "Conforming"],
    [{ state: "done", result: result({ outcome: "Needs review" }) }, "Needs review"],
    [{ state: "done", result: result() }, "Non-conforming"],
    [{ state: "done", result: result({ outcome: "Not a CoA" }) }, "Not a CoA"],
  ] as [Partial<Run>, string][])("says %j in words", (run, label) => {
    expect(renderToStaticMarkup(<StatusChip run={{ ...base, ...run }} />)).toContain(label);
  });
});

describe("RunRow", () => {
  it("links a finished run to its report and sums up the verdicts", () => {
    const html = row({ result: result() });
    expect(html).toContain('href="/runs/abc"');
    expect(html).toContain("Citric Acid · Lot L1 · Alpina");
    expect(html).toContain("9/11");
    expect(html).toContain("1 fail");
    expect(html).toContain("1 review");
    expect(html).toContain("2 min ago");
  });

  it("shows the step and the time while it is running", () => {
    const html = row({ state: "loading", startedAt: Date.now(), statuses: ["Reading the PDF", "Checking it is a CoA"] });
    expect(html).toContain("Step 2");
    expect(html).toContain("Checking it is a CoA");
  });

  it("says why a run failed", () => {
    expect(row({ state: "error", message: "model unavailable" })).toContain("model unavailable");
  });

  it("is not a link when the upload never reached the server", () => {
    expect(row({ state: "error", message: "the server answered 500", local: true })).not.toContain("href=");
  });
});
