import type { Run } from "@/components/report-context";
import { RunIcon } from "@/components/run-icon";
import { formatCost, formatDuration, formatMoment, formatTokens } from "@/lib/format";
import { isActive, tokenUsage } from "@/lib/runs";
import { cn } from "@/lib/utils";

const STATE_WORDS: Record<Run["state"], string> = { queued: "waiting", loading: "in progress", done: "done", error: "failed" };

// What the agent reported, in order, as a timeline: the last status shows the run's state, every earlier one is done. While the run
// is going, the last step is the current one (aria-current), and each step says its state in words, not only by its icon.
export function Steps({ run }: { run: Run }) {
  const { statuses, state, startedAt, finishedAt } = run;
  const running = isActive(run);
  const usage = tokenUsage(run);
  return (
    <div className="flex max-w-xl flex-col gap-6">
      {statuses.length === 0 ? (
        <p className="text-sm text-muted-foreground">No step has been reported yet.</p>
      ) : (
        <ol className="flex flex-col text-sm">
          {statuses.map((status, i) => {
            const last = i === statuses.length - 1;
            const stepState = last ? state : "done";
            return (
              // the status texts can repeat, so the position is the key
              // biome-ignore lint/suspicious/noArrayIndexKey: the list only grows at the end
              <li key={i} aria-current={last && running ? "step" : undefined} className="relative flex gap-3 pb-4 last:pb-0">
                {!last && <span aria-hidden className="absolute top-6 bottom-0 left-2 w-px -translate-x-1/2 bg-border" />}
                <span className="relative z-10 mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-background">
                  <RunIcon state={stepState} />
                </span>
                <span className={cn(last && running && "font-medium")}>
                  {status}
                  <span className="sr-only"> ({STATE_WORDS[stepState]})</span>
                </span>
              </li>
            );
          })}
        </ol>
      )}
      {startedAt > 0 && (
        <dl className="grid max-w-sm grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
          <dt className="text-muted-foreground">Started</dt>
          <dd>{formatMoment(startedAt)}</dd>
          {finishedAt > 0 && (
            <>
              <dt className="text-muted-foreground">Finished</dt>
              <dd>{formatMoment(finishedAt)}</dd>
              <dt className="text-muted-foreground">Took</dt>
              <dd className="tabular-nums">{formatDuration(finishedAt - startedAt)}</dd>
            </>
          )}
          {usage && (
            <>
              <dt className="text-muted-foreground">Tokens</dt>
              <dd className="tabular-nums">
                {formatTokens(usage.input)} in · {formatTokens(usage.output)} out
              </dd>
            </>
          )}
          {run.cost !== undefined && (
            <>
              <dt className="text-muted-foreground">Cost</dt>
              <dd className="tabular-nums">{formatCost(run.cost)}</dd>
            </>
          )}
        </dl>
      )}
    </div>
  );
}
