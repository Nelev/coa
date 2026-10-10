import type { Decision, Run } from "@/components/report-context";

// What the overview shows and filters by: a run is in progress, needs attention, conforms, or (while it is not done) is none of these yet.
export type Filter = "all" | "progress" | "attention" | "conforming" | "decision";
export type Sort = "priority" | "newest" | "oldest" | "name" | "name-desc";

const FILTERS: Filter[] = ["all", "attention", "progress", "conforming", "decision"];
export const SORT_LABELS: Record<Sort, string> = {
  priority: "Priority",
  newest: "Newest",
  oldest: "Oldest",
  name: "File name A–Z",
  "name-desc": "File name Z–A",
};
const SORTS = Object.keys(SORT_LABELS) as Sort[];

// the filter and the sort live in the address (/?filter=attention&sort=name), which anyone can edit: anything unknown means the default
export function parseFilter(value: string | null | undefined): Filter {
  return FILTERS.find((filter) => filter === value) ?? "all";
}

export function parseSort(value: string | null | undefined): Sort {
  return SORTS.find((sort) => sort === value) ?? "priority";
}

// what pressing a column header does: the same column again reverses it; another column starts at its natural order
export function nextSort(current: Sort, column: "status" | "name" | "when"): Sort {
  if (column === "status") return "priority";
  if (column === "name") return current === "name" ? "name-desc" : "name";
  return current === "newest" ? "oldest" : "newest";
}

// queued or being analyzed: the run will still change
export function isActive(run: Run): boolean {
  return run.state === "queued" || run.state === "loading";
}

// a person has approved or rejected the lot: nothing is left to do with it
export function isDecided(run: Run): boolean {
  return run.decision === "approved" || run.decision === "rejected";
}

// analyzed, and waiting for a person to approve, reject or hold it (a lot on hold is still waiting)
export function awaitingDecision(run: Run): boolean {
  return run.state === "done" && !isDecided(run);
}

// approving a lot the agent did not find conforming (an override), and rejecting or holding any lot, must be explained
export function requiresReason(decision: Decision, run: Run): boolean {
  return decision !== "approved" || run.result?.outcome !== "Conforming";
}

export function filterOf(run: Run): Exclude<Filter, "all" | "decision"> {
  if (isActive(run)) return "progress";
  return run.state === "done" && run.result?.outcome === "Conforming" ? "conforming" : "attention"; // a failed run, a non-conforming or unclear certificate
}

// lower comes first: what is running, then the worst findings, then what is fine
function urgency(run: Run): number {
  if (run.state === "loading") return 0;
  if (run.state === "queued") return 1;
  if (run.state === "error") return 2;
  if (!run.result) return 5; // analyzed before results were stored: look at it like a review
  switch (run.result.outcome) {
    case "Non-conforming":
      return 3;
    case "Not a CoA":
      return 4;
    case "Needs review":
      return 5;
    case "Conforming":
      return 6;
  }
}

// the server lists the oldest first, so the newest come first once reversed; the sort is stable, so runs of the same priority keep that order
// what a person has decided goes after everything that is still open
const byPriority = (a: Run, b: Run) => Number(isDecided(a)) - Number(isDecided(b)) || urgency(a) - urgency(b);

const byName = (a: Run, b: Run) => a.filename.localeCompare(b.filename, undefined, { numeric: true, sensitivity: "base" });

export function sortRuns(runs: Run[], sort: Sort): Run[] {
  const newest = [...runs].reverse();
  switch (sort) {
    case "priority":
      return newest.sort(byPriority);
    case "newest":
      return newest;
    case "oldest":
      return [...runs];
    case "name":
      return newest.sort(byName);
    case "name-desc":
      return newest.sort((a, b) => byName(b, a));
  }
}

// `needle` is already trimmed and lower-cased, so a list is not normalized once per run
export function matchesQuery(run: Run, needle: string): boolean {
  return [run.filename, run.result?.product, run.result?.lot, run.result?.supplier].some((text) => text?.toLowerCase().includes(needle));
}

function inFilter(run: Run, filter: Filter): boolean {
  if (filter === "all") return true;
  return filter === "decision" ? awaitingDecision(run) : filterOf(run) === filter;
}

export function visibleRuns(runs: Run[], filter: Filter, query: string, sort: Sort): Run[] {
  const needle = query.trim().toLowerCase();
  return sortRuns(
    runs.filter((run) => inFilter(run, filter) && (!needle || matchesQuery(run, needle))),
    sort,
  );
}

export type Tally = {
  all: number;
  progress: number;
  attention: number;
  conforming: number;
  awaiting: number;
};

export function tally(runs: Run[]): Tally {
  const counts: Tally = { all: runs.length, progress: 0, attention: 0, conforming: 0, awaiting: 0 };
  for (const run of runs) {
    counts[filterOf(run)] += 1;
    if (awaitingDecision(run)) counts.awaiting += 1;
  }
  return counts;
}

export function totalTests({ counts }: NonNullable<Run["result"]>): number {
  return counts.pass + counts.fail + counts.review;
}
