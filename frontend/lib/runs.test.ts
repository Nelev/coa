import { describe, expect, it } from "vitest";
import type { Outcome, Run } from "@/components/report-context";
import { filterOf, matchesQuery, sortRuns, tally, visibleRuns } from "@/lib/runs";

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
    expect(tally(RUNS)).toEqual({ all: 7, progress: 2, attention: 4, conforming: 1, nonConforming: 1, review: 1, queued: 1 });
  });
});
