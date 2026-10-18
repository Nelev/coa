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
    [{ state: "waiting" }, "Needs your answer"],
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
  it("says a waiting run has a question, instead of showing progress", () => {
    const html = row({ state: "waiting", finishedAt: 0 });
    expect(html).toContain("The agent has a question for you");
    expect(html).not.toContain("progress-shimmer");
  });

  it("links a finished run to its report and sums up the verdicts", () => {
    const html = row({ result: result() });
    expect(html).toContain('href="/runs/abc"');
    expect(html).toContain("Citric Acid · Lot L1 · Alpina");
    expect(html).toContain("9/11");
    expect(html).toContain("1 fail");
    expect(html).toContain("1 review");
    expect(html).toContain("2 min ago");
  });

  it("shows how long a finished run took, and nothing while it is still running", () => {
    expect(row({ result: result(), startedAt: NOW - 125_000, finishedAt: NOW - 120_000 })).toContain("5.0s");
    expect(row({ state: "loading", startedAt: NOW - 3_000, finishedAt: 0 })).not.toContain("3.0s");
  });

  it("shows what a run cost and the tokens it used, and nothing for a run that has no usage", () => {
    const html = row({ result: result(), inputTokens: 11_000, outputTokens: 1_400, cost: 0.0031 });
    expect(html).toContain("$0.0031");
    expect(html).toContain("12.4k tokens");
    expect(row({ result: result() })).not.toContain("tokens");
  });

  it("shows the tokens even when the provider did not say what they cost", () => {
    const html = row({ result: result(), inputTokens: 500, outputTokens: 20 });
    expect(html).toContain("520 tokens");
    expect(html).not.toContain("$");
  });

  it("shows the step and the time while it is running", () => {
    const html = row({ state: "loading", startedAt: Date.now(), statuses: ["Reading the PDF", "Checking it is a CoA"] });
    expect(html).toContain("Step 2");
    expect(html).toContain("Checking it is a CoA");
  });

  it("shows what a person decided about the lot", () => {
    expect(row({ result: result(), decision: "rejected", decidedBy: "QA Anna" })).toContain("Rejected");
    expect(row({ result: result() })).not.toContain("Rejected");
  });

  it("says why a run failed", () => {
    expect(row({ state: "error", message: "model unavailable" })).toContain("model unavailable");
  });

  it("is not a link when the upload never reached the server", () => {
    expect(row({ state: "error", message: "the server answered 500", local: true })).not.toContain("href=");
  });
});
