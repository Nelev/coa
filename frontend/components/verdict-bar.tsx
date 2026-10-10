import type { RunResult } from "@/components/report-context";
import { cn } from "@/lib/utils";

const PARTS = [
  { key: "pass", label: "pass", bar: "bg-success", dot: "bg-success" },
  { key: "review", label: "to review", bar: "bg-warning", dot: "bg-warning" },
  { key: "fail", label: "fail", bar: "bg-destructive", dot: "bg-destructive" },
] as const;

// "9 of 11 tests pass, 1 to review, 1 fail"
export function verdictSentence({ pass, review, fail }: RunResult["counts"]): string {
  const total = pass + review + fail;
  if (total === 0) return "No test could be checked.";
  return [`${pass} of ${total} ${total === 1 ? "test passes" : "tests pass"}`, review > 0 && `${review} to review`, fail > 0 && `${fail} fail`]
    .filter(Boolean)
    .join(", ");
}

// what the agent found, in a sentence: the counts of a certificate, or that the document is not one
export function resultSentence({ outcome, counts }: RunResult): string {
  return outcome === "Not a CoA" ? "This document is not a Certificate of Analysis." : verdictSentence(counts);
}

// The tests of the lot as one bar in three parts, with the numbers beside it, so the colors are never the only thing that tells them apart.
export function VerdictBar({ counts }: { counts: RunResult["counts"] }) {
  const total = counts.pass + counts.review + counts.fail;
  if (total === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <div role="img" aria-label={verdictSentence(counts)} className="flex h-2.5 gap-0.5 overflow-hidden rounded-full bg-muted">
        {PARTS.map(({ key, bar }) => (counts[key] > 0 ? <div key={key} className={cn("h-full", bar)} style={{ flexGrow: counts[key] }} /> : null))}
      </div>
      <ul aria-hidden className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
        {PARTS.map(({ key, label, dot }) => (
          <li key={key} className="flex items-center gap-1.5">
            <span className={cn("size-2 rounded-full", dot, counts[key] === 0 && "opacity-30")} />
            <span className="font-medium text-foreground tabular-nums">{counts[key]}</span> {label}
          </li>
        ))}
      </ul>
    </div>
  );
}
