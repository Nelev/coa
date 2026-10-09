import type { Run } from "@/components/report-context";
import { RunIcon } from "@/components/run-icon";
import { formatDuration } from "@/lib/format";

// what the agent reported, in order; the last status shows the run's state, every earlier one is done
export function Steps({ run: { statuses, state, startedAt, finishedAt } }: { run: Run }) {
  const moment = (time: number) => new Date(time).toLocaleString();
  return (
    <div className="flex flex-col gap-6">
      {statuses.length === 0 ? (
        <p className="text-sm text-muted-foreground">No step has been reported yet.</p>
      ) : (
        <ol className="flex flex-col gap-3 text-sm">
          {statuses.map((status, i) => (
            // the status texts can repeat, so the position is the key
            // biome-ignore lint/suspicious/noArrayIndexKey: the list only grows at the end
            <li key={i} className="flex items-center gap-3">
              <RunIcon state={i === statuses.length - 1 ? state : "done"} />
              {status}
            </li>
          ))}
        </ol>
      )}
      {startedAt > 0 && (
        <dl className="grid max-w-sm grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
          <dt className="text-muted-foreground">Started</dt>
          <dd>{moment(startedAt)}</dd>
          {finishedAt > 0 && (
            <>
              <dt className="text-muted-foreground">Finished</dt>
              <dd>{moment(finishedAt)}</dd>
              <dt className="text-muted-foreground">Took</dt>
              <dd className="tabular-nums">{formatDuration(finishedAt - startedAt)}</dd>
            </>
          )}
        </dl>
      )}
    </div>
  );
}
