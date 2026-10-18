import { ChevronRight } from "lucide-react";
import Link from "next/link";

import { preloadReport, type Run } from "@/components/report-context";
import { RunProgress } from "@/components/run-progress";
import { DecisionChip, StatusChip } from "@/components/status-chip";
import { Button } from "@/components/ui/button";
import { formatCost, formatDuration, formatTokens, relativeTime } from "@/lib/format";
import { isActive, isWaiting, tokenUsage, totalTests } from "@/lib/runs";
import { cn } from "@/lib/utils";

// "Citric Acid · Lot L26-09-3315 · Alpina Chemicals", with the parts that exist
function describe(run: Run): string {
  const { product, lot, supplier } = run.result ?? {};
  return [product, lot && `Lot ${lot}`, supplier].filter(Boolean).join(" · ");
}

function Verdict({ run }: { run: Run }) {
  if (isActive(run)) return <RunProgress run={run} />;
  if (isWaiting(run)) return <p className="text-sm text-warning">The agent has a question for you</p>;
  if (run.state === "error") return <p className="text-sm break-words text-destructive md:truncate">{run.message}</p>;
  if (!run.result) return null;
  const { counts, outcome } = run.result;
  if (outcome === "Not a CoA") return <p className="text-sm text-muted-foreground">This document is not a Certificate of Analysis</p>;
  return (
    <p className="text-sm text-muted-foreground">
      <span className="font-medium text-foreground tabular-nums">
        {counts.pass}/{totalTests(run.result)}
      </span>{" "}
      pass
      {counts.fail > 0 && <span className="text-destructive tabular-nums"> · {counts.fail} fail</span>}
      {counts.review > 0 && <span className="text-warning tabular-nums"> · {counts.review} review</span>}
    </p>
  );
}

// what the agent found, and what a person decided; on a phone it sits under the file name, on a wide screen in its own column
function Outcome({ run, onRetry, onDismiss }: { run: Run; onRetry?: (id: string) => void; onDismiss?: (id: string) => void }) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
      <Verdict run={run} />
      <DecisionChip run={run} />
      {/* an upload that failed is not on the server: the person can send the file again, or let it go */}
      {run.local && (
        <span className="flex gap-2">
          {onRetry && (
            <Button variant="outline" size="sm" aria-label={`Try uploading ${run.filename} again`} onClick={() => onRetry(run.id)}>
              Try again
            </Button>
          )}
          {onDismiss && (
            <Button variant="ghost" size="sm" aria-label={`Remove ${run.filename} from the list`} onClick={() => onDismiss(run.id)}>
              Remove
            </Button>
          )}
        </span>
      )}
    </div>
  );
}

const CELL = "border-b px-4 py-3 align-middle group-last/row:border-b-0 group-data-[compact]/row:pointer-fine:py-1.5";

// One run, a row of the table. The file name is the link, and its ::after covers the whole row, so the row is one big target for the
// pointer while a screen reader meets one link (not four) and the keyboard stops once per row. On a narrow screen (`wide` is false) the
// "Result", "Duration", "Cost" and "Updated" columns are not there and their content goes under the file name; only the one layout that is shown is mounted.
export function RunRow({
  run,
  now,
  compact = false,
  wide = true,
  onRetry,
  onDismiss,
}: {
  run: Run;
  now: number;
  compact?: boolean;
  wide?: boolean;
  onRetry?: (id: string) => void;
  onDismiss?: (id: string) => void;
}) {
  const when = run.finishedAt || run.startedAt;
  const time = when ? relativeTime(when, now) : "";
  const took = run.startedAt > 0 && run.finishedAt >= run.startedAt ? formatDuration(run.finishedAt - run.startedAt) : ""; // only a run that has ended
  const usage = tokenUsage(run);
  const tokens = usage ? `${formatTokens(usage.input + usage.output)} tokens` : "";
  const cost = run.cost !== undefined ? formatCost(run.cost) : "";
  const filename = "block truncate text-sm font-medium";
  const outcome = <Outcome run={run} onRetry={onRetry} onDismiss={onDismiss} />;
  return (
    <tr
      data-compact={compact || undefined}
      className={cn("group/row relative transition-colors", !run.local && "hover:bg-muted/60 has-[a:focus-visible]:bg-muted/60")}
    >
      <td className={CELL}>
        <StatusChip run={run} />
      </td>
      <td className={CELL}>
        {run.local ? (
          <p className={filename}>{run.filename}</p>
        ) : (
          <Link
            href={`/runs/${run.id}`}
            data-row
            onPointerEnter={preloadReport}
            onFocus={preloadReport}
            className={cn(
              filename,
              "rounded-sm outline-none after:absolute after:inset-0 focus-visible:after:ring-2 focus-visible:after:ring-ring focus-visible:after:ring-inset",
            )}
          >
            {run.filename}
          </Link>
        )}
        <p className="truncate text-xs text-subtle-foreground">{describe(run) || (run.state === "done" ? "Product not stated" : " ")}</p>
        {!wide && (
          <div className="mt-1.5 flex flex-col gap-1">
            {outcome}
            {time && (
              <p className="text-xs text-subtle-foreground tabular-nums">
                {[time, took && `took ${took}`, cost, tokens].filter(Boolean).join(" · ")}
              </p>
            )}
          </div>
        )}
      </td>
      {wide && (
        <>
          <td className={CELL}>{outcome}</td>
          <td className={cn(CELL, "text-right text-xs whitespace-nowrap text-subtle-foreground tabular-nums")}>{took}</td>
          <td className={cn(CELL, "text-right text-xs whitespace-nowrap tabular-nums")}>
            <p className="text-muted-foreground">{cost}</p>
            <p className="text-subtle-foreground">{tokens}</p>
          </td>
          <td className={CELL}>
            <div className="flex items-center justify-end gap-2 text-xs whitespace-nowrap text-subtle-foreground">
              {time}
              {!run.local && <ChevronRight aria-hidden className="size-4 transition-transform group-hover/row:translate-x-0.5" />}
            </div>
          </td>
        </>
      )}
    </tr>
  );
}
