import { describe, expect, it } from "vitest";
import type { Outcome, Run } from "@/components/report-context";
import { awaitingDecision, filterOf, matchesQuery, nextSort, parseFilter, parseSort, requiresReason, sortRuns, tally, visibleRuns } from "@/lib/runs";

function run(id: string, state: Run["state"], outcome?: Outcome, extra: Partial<Run> = {}): Run {
  const result = outcome && { outcome, counts: { pass: 1, fail: 0, review: 0 }, product: "Citric Acid", lot: `L-${id}`, supplier: "Alpina" };
  return { id, filename: `${id}.pdf`, state, startedAt: 1, finishedAt: 2, statuses: [], result: result || undefined, ...extra };
}

// oldest first, as the server lists them
const RUNS = [
  run("ok", "done", "Conforming"),
  run("review", "done", "Needs review"),
  run("bad", "done", "Non-conforming"),
  run("failed", "error"),
  run("busy", "loading"),
  run("waiting", "queued"),
  run("invoice", "done", "Not a CoA"),
];

describe("filterOf", () => {
  it("groups the runs by what the user has to do", () => {
    expect(RUNS.map(filterOf)).toEqual(["conforming", "attention", "attention", "attention", "progress", "progress", "attention"]);
  });
});

describe("a run without a stored result", () => {
  it("is not assumed to conform", () => {
    expect(filterOf(run("legacy", "done"))).toBe("attention");
  });
});

describe("sortRuns", () => {
  it("puts what is running first, then the worst findings, then what conforms", () => {
    expect(sortRuns(RUNS, "priority").map((r) => r.id)).toEqual(["busy", "waiting", "failed", "bad", "invoice", "review", "ok"]);
  });

  it("keeps the newest first within the same priority", () => {
    const two = [run("old", "done", "Conforming"), run("new", "done", "Conforming")];
    expect(sortRuns(two, "priority").map((r) => r.id)).toEqual(["new", "old"]);
  });

  it("can list the newest first regardless of the outcome", () => {
    expect(sortRuns(RUNS, "newest").map((r) => r.id)).toEqual(["invoice", "waiting", "busy", "failed", "bad", "review", "ok"]);
  });

  it("does not change the list it is given", () => {
    const copy = [...RUNS];
    sortRuns(RUNS, "priority");
    expect(RUNS).toEqual(copy);
  });
});

describe("matchesQuery", () => {
  it("looks in the file name, product, lot and supplier, ignoring case", () => {
    const r = run("a", "done", "Conforming");
    expect(["a.pdf", "citric", "l-a", "alpina"].every((needle) => matchesQuery(r, needle))).toBe(true);
    expect(matchesQuery(r, "sodium")).toBe(false);
  });
});

describe("visibleRuns", () => {
  it("applies the filter and the search together", () => {
    expect(visibleRuns(RUNS, "attention", "", "priority").map((r) => r.id)).toEqual(["failed", "bad", "invoice", "review"]);
    expect(visibleRuns(RUNS, "attention", "l-bad", "priority").map((r) => r.id)).toEqual(["bad"]);
    expect(visibleRuns(RUNS, "all", "", "priority")).toHaveLength(RUNS.length);
    expect(visibleRuns(RUNS, "all", "  ALPINA ", "priority")).toHaveLength(RUNS.filter((r) => r.result).length); // trimmed, any case
  });
});

describe("tally", () => {
  it("counts the runs per filter and the details the tiles show", () => {
    expect(tally(RUNS)).toEqual({ all: 7, progress: 2, attention: 4, conforming: 1, awaiting: 4 });
  });
});

describe("decisions", () => {
  const approved = run("approved", "done", "Conforming", { decision: "approved" });
  const rejected = run("rejected", "done", "Non-conforming", { decision: "rejected" });
  const held = run("held", "done", "Needs review", { decision: "on_hold" });
  const open = run("open", "done", "Conforming");

  it("waits for a decision on what is analyzed and not approved or rejected yet, a lot on hold included", () => {
    expect([approved, rejected, held, open, run("busy", "loading"), run("failed", "error")].map(awaitingDecision)).toEqual([
      false,
      false,
      true,
      true,
      false,
      false,
    ]);
  });

  it("filters by what awaits a decision, and counts it", () => {
    const all = [approved, rejected, held, open];
    expect(visibleRuns(all, "decision", "", "priority").map((r) => r.id)).toEqual(["held", "open"]);
    expect(tally(all).awaiting).toBe(2);
  });

  it("keeps a decided run in its group, so the outcome tiles still add up", () => {
    expect(filterOf(rejected)).toBe("attention");
    expect(filterOf(approved)).toBe("conforming");
  });

  it("lists decided runs after everything that still needs a person", () => {
    const all = [approved, rejected, held, open];
    expect(sortRuns(all, "priority").map((r) => r.id)).toEqual(["held", "open", "rejected", "approved"]);
  });

  it("asks for a reason to reject or hold, and to approve what does not conform", () => {
    expect(requiresReason("approved", open)).toBe(false);
    expect(requiresReason("approved", held)).toBe(true);
    expect(requiresReason("approved", run("legacy", "done"))).toBe(true); // an outcome that is not known is not assumed to conform
    expect(requiresReason("rejected", open)).toBe(true);
    expect(requiresReason("on_hold", open)).toBe(true);
  });
});

describe("the address", () => {
  it("falls back to the defaults for anything it does not know", () => {
    expect(parseFilter("attention")).toBe("attention");
    expect(parseFilter("nonsense")).toBe("all");
    expect(parseFilter(null)).toBe("all");
    expect(parseSort("name-desc")).toBe("name-desc");
    expect(parseSort("<script>")).toBe("priority");
    expect(parseSort(undefined)).toBe("priority");
  });
});

describe("sorting by column", () => {
  it("reverses a column when it is pressed again, and starts others at their natural order", () => {
    expect(nextSort("priority", "name")).toBe("name");
    expect(nextSort("name", "name")).toBe("name-desc");
    expect(nextSort("name-desc", "name")).toBe("name");
    expect(nextSort("priority", "when")).toBe("newest");
    expect(nextSort("newest", "when")).toBe("oldest");
    expect(nextSort("name", "status")).toBe("priority");
  });

  it("orders by file name, numbers as numbers", () => {
    const files = ["coa-10.pdf", "coa-2.pdf", "Coa-1.pdf"].map((filename, i) => run(`r${i}`, "done", "Conforming", { filename }));
    expect(sortRuns(files, "name").map((r) => r.filename)).toEqual(["Coa-1.pdf", "coa-2.pdf", "coa-10.pdf"]);
    expect(sortRuns(files, "name-desc").map((r) => r.filename)).toEqual(["coa-10.pdf", "coa-2.pdf", "Coa-1.pdf"]);
  });

  it("lists the oldest first, as the server does", () => {
    expect(sortRuns(RUNS, "oldest").map((r) => r.id)).toEqual(RUNS.map((r) => r.id));
    expect(sortRuns(RUNS, "newest")[0].id).toBe("invoice");
  });
});
