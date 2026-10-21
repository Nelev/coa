import type { RunResult } from "@/components/report-context";
import { cn } from "@/lib/utils";

const PARTS = [
  { key: "pass", label: "pass", dot: "bg-success" },
  { key: "review", label: "to review", dot: "bg-warning" },
  { key: "fail", label: "fail", dot: "bg-destructive" },
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

// The tests of the lot counted by verdict, each with its colored dot. The sentence beside it says the same in words, so it is hidden from a screen reader.
export function VerdictBar({ counts }: { counts: RunResult["counts"] }) {
  const total = counts.pass + counts.review + counts.fail;
  if (total === 0) return null;
  return (
    <ul aria-hidden className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
      {PARTS.map(({ key, label, dot }) => (
        <li key={key} className="flex items-center gap-1.5">
          <span className={cn("size-2 rounded-full", dot, counts[key] === 0 && "opacity-30")} />
          <span className="font-medium text-foreground tabular-nums">{counts[key]}</span> {label}
        </li>
      ))}
    </ul>
  );
}
