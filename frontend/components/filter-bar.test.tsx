import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FilterBar } from "@/components/filter-bar";
import type { Outcome, Run } from "@/components/report-context";
import { tally } from "@/lib/runs";

function run(id: string, outcome: Outcome): Run {
  const result = { outcome, counts: { pass: 1, fail: 0, review: 0 }, product: "Citric Acid", lot: id, supplier: "Alpina" };
  return { id, filename: `${id}.pdf`, state: "done", startedAt: 1, finishedAt: 2, statuses: [], result };
}

describe("FilterBar", () => {
  it("marks the filter that is on and shows every count", () => {
    const runs = [run("ok", "Conforming"), run("bad", "Non-conforming")];
    const html = renderToStaticMarkup(<FilterBar tally={tally(runs)} filter="attention" onChange={() => {}} />);
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(html).toMatch(/aria-pressed="true"[^>]*>Needs attention/);
    expect(html).toContain("All runs");
    expect(html).toContain("Awaiting decision");
  });
});
