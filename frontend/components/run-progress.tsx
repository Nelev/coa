import { Elapsed } from "@/components/elapsed";
import type { Run } from "@/components/report-context";

// How far a running analysis is, in words and a moving bar. The graph branches, so there is no honest percentage: the
// bar only shows that work is going on, the text says which step and for how long.
export function RunProgress({ run }: { run: Run }) {
  const queued = run.state === "queued";
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="h-1 overflow-hidden rounded-full bg-muted" role="presentation">
        {!queued && <div className="progress-shimmer h-full w-full rounded-full bg-info/70" />}
      </div>
      <p className="truncate text-xs text-muted-foreground">
        {queued ? (
          "Waiting for a free slot…"
        ) : (
          <>
            Step {Math.max(run.statuses.length, 1)} · {run.statuses.at(-1) ?? "Starting"}… · <Elapsed since={run.startedAt} />
          </>
        )}
      </p>
    </div>
  );
}
