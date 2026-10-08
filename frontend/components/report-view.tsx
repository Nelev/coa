"use client";

import { Check, Circle, Loader2, Minus, X } from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

import { useReport, type Step, type Steps } from "@/components/report-context";
import { cn } from "@/lib/utils";

// json-render, its shadcn components and zod are only needed once a report arrives; upload() preloads this chunk.
const ReportRenderer = dynamic(() => import("@/components/report-renderer").then((m) => m.ReportRenderer));

// agent graph node -> label, in run order
// (compare_specs is skipped when the product has no plant spec; a document that is not a CoA skips to render_ui)
const STEPS = [
  ["load_document", "Reading the PDF"],
  ["validate_document", "Checking it is a CoA"],
  ["get_document_data", "Extracting the CoA data"],
  ["load_plant_spec", "Finding the plant specification"],
  ["compare_specs", "Comparing results with the specification"],
  ["render_ui", "Building the report"],
] as const;

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
  skipped: <Minus className="size-4" />,
  pending: <Circle className="size-4" />,
};

function StepRow({ label, step, skipped }: { label: string; step?: Step; skipped: boolean }) {
  const status = step?.status ?? (skipped ? "skipped" : "pending");
  return (
    <li className={cn("flex flex-col gap-0.5", (status === "pending" || status === "skipped") && "text-muted-foreground")}>
      <div className="flex items-center gap-2">
        {ICONS[status]}
        <span>{label}</span>
        {status === "skipped" && <span className="text-xs">skipped</span>}
        {status === "failed" && <span className="text-xs text-destructive">failed</span>}
        {/* a running step counts up from when its "start" line arrived; a finished one shows the server's measurement */}
        {(step?.status === "running" || step?.ms !== undefined) && (
          <span className="ml-auto tabular-nums text-xs text-muted-foreground">
            {step.status === "running" ? <Elapsed since={step.startedAt} /> : formatDuration(step.ms!)}
          </span>
        )}
      </div>
      {step?.output && <p className="pl-6 text-xs text-muted-foreground">{step.output}</p>}
    </li>
  );
}

// `active` is false once the run has stopped, so the total stops counting
function Progress({ filename, startedAt, steps, active }: { filename: string; startedAt: number; steps: Steps; active: boolean }) {
  return (
    <div aria-busy={active} aria-live="polite">
      <p className="mb-3 flex gap-2 text-sm text-muted-foreground">
        <span>{active ? `Analyzing ${filename}…` : filename}</span>
        {active && <span className="tabular-nums">· <Elapsed since={startedAt} /></span>}
      </p>
      <ol className="flex flex-col gap-2 text-sm">
        {STEPS.map(([node, label], i) => (
          // a step that never started while a later one did was routed around
          <StepRow key={node} label={label} step={steps[node]} skipped={STEPS.slice(i + 1).some(([later]) => later in steps)} />
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
      return <Progress filename={report.filename} startedAt={report.startedAt} steps={report.steps} active />;
    case "error":
      return (
        <div className="flex flex-col gap-4">
          <p role="alert" className="text-sm text-destructive">
            The document could not be analyzed: {report.message}. Is the backend running?
          </p>
          {report.run && Object.keys(report.run.steps).length > 0 && <Progress {...report.run} active={false} />}
        </div>
      );
    case "done":
      return <ReportRenderer spec={report.spec} />;
  }
}
