"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

import { type Run, useReport } from "@/components/report-context";
import { RunIcon } from "@/components/run-icon";

// json-render, its shadcn components and zod are only needed once a report arrives; upload() preloads this chunk.
const ReportRenderer = dynamic(() => import("@/components/report-renderer").then((m) => m.ReportRenderer));

// 1.8s, 42.0s, 1m 05s; below a second the exact milliseconds
function formatDuration(ms: number) {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = ms / 1000;
  return seconds < 60 ? `${seconds.toFixed(1)}s` : `${Math.floor(seconds / 60)}m ${String(Math.floor(seconds % 60)).padStart(2, "0")}s`;
}

// counts up from `since` (a Date.now() value); it owns its timer so only this text re-renders on each tick
function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(timer);
  }, []);
  return formatDuration(now - since);
}

// the last status shows the run's state (running, done or failed), every earlier one is done
function Progress({ run: { filename, startedAt, statuses, state } }: { run: Run }) {
  const running = state === "loading";
  return (
    <div aria-busy={running} aria-live="polite">
      <p className="mb-3 flex gap-2 text-sm text-muted-foreground">
        <span>{running ? `Analyzing ${filename}…` : filename}</span>
        {running && (
          <span className="tabular-nums">
            · <Elapsed since={startedAt} />
          </span>
        )}
      </p>
      <ol className="flex flex-col gap-2 text-sm">
        {statuses.map((status, i) => (
          // the status texts can repeat, so the position is the key
          // biome-ignore lint/suspicious/noArrayIndexKey: the list only grows at the end
          <li key={i} className="flex items-center gap-2">
            <RunIcon state={i === statuses.length - 1 ? state : "done"} />
            {status}
          </li>
        ))}
      </ol>
    </div>
  );
}

export function ReportView() {
  const { runs, selectedId } = useReport();
  const run = runs.find((r) => r.id === selectedId);

  if (!run) return <p className="text-sm text-muted-foreground">Upload CoA PDFs from the sidebar to generate reports.</p>;

  switch (run.state) {
    case "queued":
      return <p className="text-sm text-muted-foreground">{run.filename} is waiting for a free slot…</p>;
    case "loading":
      return <Progress run={run} />;
    case "error":
      return (
        <div className="flex flex-col gap-4">
          <p role="alert" className="text-sm text-destructive">
            {run.filename} could not be analyzed: {run.message}. Is the backend running?
          </p>
          {run.statuses.length > 0 && <Progress run={run} />}
        </div>
      );
    case "done":
      return (
        <div className="flex flex-col gap-6">
          <Progress run={run} />
          <ReportRenderer spec={run.spec} />
        </div>
      );
  }
}
