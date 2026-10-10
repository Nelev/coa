import { ChevronRight } from "lucide-react";
import Link from "next/link";

import { preloadReport, type Run } from "@/components/report-context";
import { RunProgress } from "@/components/run-progress";
import { DecisionChip, StatusChip } from "@/components/status-chip";
import { relativeTime } from "@/lib/format";
import { isActive, totalTests } from "@/lib/runs";
import { cn } from "@/lib/utils";

// "Citric Acid · Lot L26-09-3315 · Alpina Chemicals", with the parts that exist
function describe(run: Run): string {
  const { product, lot, supplier } = run.result ?? {};
  return [product, lot && `Lot ${lot}`, supplier].filter(Boolean).join(" · ");
}

function Verdict({ run }: { run: Run }) {
  if (isActive(run)) return <RunProgress run={run} />;
  if (run.state === "error") return <p className="truncate text-sm text-destructive">{run.message}</p>;
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

const ROW = "grid items-center gap-x-4 gap-y-2 px-4 py-3 md:grid-cols-[9.5rem_minmax(0,1.2fr)_minmax(0,1fr)_6rem_1rem]";

export function RunRow({ run, now }: { run: Run; now: number }) {
  const body = (
    <>
      <div>
        <StatusChip run={run} />
      </div>
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{run.filename}</p>
        <p className="truncate text-xs text-subtle-foreground">{describe(run) || (run.state === "done" ? "Product not stated" : " ")}</p>
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
        <Verdict run={run} />
        <DecisionChip run={run} />
      </div>
      <p className="text-xs text-subtle-foreground md:text-right">
        {run.finishedAt || run.startedAt ? relativeTime(run.finishedAt || run.startedAt, now) : ""}
      </p>
      {!run.local && (
        <ChevronRight aria-hidden className="hidden size-4 text-subtle-foreground transition-transform group-hover/row:translate-x-0.5 md:block" />
      )}
    </>
  );

  // an upload that failed is not on the server: there is nothing to open
  if (run.local) return <div className={ROW}>{body}</div>;
  return (
    <Link
      href={`/runs/${run.id}`}
      data-row
      onPointerEnter={preloadReport}
      onFocus={preloadReport}
      className={cn(
        ROW,
        "group/row outline-none transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
      )}
    >
      {body}
    </Link>
  );
}
