import type { ReactNode } from "react";
import type { Run } from "@/components/report-context";
import { RunProgress } from "@/components/run-progress";
import { DecisionChip, StatusChip } from "@/components/status-chip";
import { resultSentence, VerdictBar } from "@/components/verdict-bar";
import { isActive } from "@/lib/runs";

// "Citric Acid · Lot L26-09-3402", or the file name when the certificate did not say
export function runTitle(run: Run): string {
  const { product, lot } = run.result ?? {};
  return [product, lot && `Lot ${lot}`].filter(Boolean).join(" · ") || run.filename;
}

// The top of a run's page: what it is, what the agent found (the verdict, in words and in counts), and what a person decided. The report
// below has the details. `actions` are the buttons at the right (open the certificate, go to the next run).
export function RunSummary({ run, actions }: { run: Run; actions: ReactNode }) {
  const supplier = run.result?.supplier;
  const subtitle = [supplier, runTitle(run) !== run.filename && run.filename].filter(Boolean).join(" · ");
  const words = run.result ? resultSentence(run.result) : null;
  return (
    <header className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight text-balance">{runTitle(run)}</h1>
          {subtitle ? <p className="text-sm break-words text-muted-foreground">{subtitle}</p> : null}
        </div>
        <div className="flex flex-wrap items-center gap-3">{actions}</div>
      </div>

      <div className="flex flex-col gap-4 rounded-2xl bg-card p-5 ring-1 ring-foreground/10">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <StatusChip run={run} large />
          <DecisionChip run={run} large />
          {words ? <p className="text-sm text-muted-foreground">{words}</p> : null}
        </div>
        {run.result && run.result.outcome !== "Not a CoA" ? <VerdictBar counts={run.result.counts} /> : null}
        {isActive(run) ? <RunProgress run={run} /> : null}
      </div>
    </header>
  );
}
