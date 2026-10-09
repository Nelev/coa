"use client";

import { Check, Loader2, X } from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

import { useReport } from "@/components/report-context";

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

// static, so created once instead of on every render of every row
const ICONS = {
  done: <Check className="size-4" />,
  running: <Loader2 className="size-4 animate-spin" />,
  failed: <X className="size-4 text-destructive" />,
};

type Outcome = "running" | "done" | "failed";

// `outcome` is how the run ended, or "running" while it goes on; it applies to the last status, every earlier one is done
function Progress({ filename, startedAt, statuses, outcome }: { filename: string; startedAt: number; statuses: string[]; outcome: Outcome }) {
  const running = outcome === "running";
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
            {ICONS[i === statuses.length - 1 ? outcome : "done"]}
            {status}
          </li>
        ))}
      </ol>
    </div>
  );
}

export function ReportView() {
  const { report } = useReport();

  switch (report.status) {
    case "idle":
      return <p className="text-sm text-muted-foreground">Upload a CoA PDF from the sidebar to generate a report.</p>;
    case "loading":
      return <Progress filename={report.filename} startedAt={report.startedAt} statuses={report.statuses} outcome="running" />;
    case "error":
      return (
        <div className="flex flex-col gap-4">
          <p role="alert" className="text-sm text-destructive">
            The document could not be analyzed: {report.message}. Is the backend running?
          </p>
          {report.run && report.run.statuses.length > 0 && <Progress {...report.run} outcome="failed" />}
        </div>
      );
    case "done":
      return (
        <div className="flex flex-col gap-6">
          <Progress filename={report.filename} startedAt={report.startedAt} statuses={report.statuses} outcome="done" />
          <ReportRenderer spec={report.spec} />
        </div>
      );
  }
}
