"use client";

import { Check, Circle, Loader2 } from "lucide-react";
import dynamic from "next/dynamic";

import { useReport } from "@/components/report-context";

// json-render, its shadcn components and zod are only needed once a report arrives; upload() preloads this chunk.
const ReportRenderer = dynamic(() => import("@/components/report-renderer").then((m) => m.ReportRenderer));

// agent graph node -> label, in run order (compare_specs is skipped when the product has no plant spec)
const STEPS = [
  ["load_document", "Reading the PDF"],
  ["get_document_data", "Extracting the CoA data"],
  ["load_plant_spec", "Finding the plant specification"],
  ["compare_specs", "Comparing results with the specification"],
  ["render_ui", "Building the report"],
] as const;

function Progress({ filename, steps }: { filename: string; steps: string[] }) {
  const current = STEPS.findLastIndex(([node]) => steps.includes(node)) + 1; // a skipped step counts as done
  return (
    <div aria-busy="true" aria-live="polite">
      <p className="mb-3 text-sm text-muted-foreground">Analyzing {filename}…</p>
      <ol className="flex flex-col gap-2 text-sm">
        {STEPS.map(([node, label], i) => (
          <li key={node} className={`flex items-center gap-2 ${i > current ? "text-muted-foreground" : ""}`}>
            {i < current ? <Check className="size-4" /> : i === current ? <Loader2 className="size-4 animate-spin" /> : <Circle className="size-4" />}
            {label}
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
      return <Progress filename={report.filename} steps={report.steps} />;
    case "error":
      return (
        <p role="alert" className="text-sm text-destructive">
          The document could not be analyzed: {report.message}. Is the backend running?
        </p>
      );
    case "done":
      return <ReportRenderer spec={report.spec} />;
  }
}
