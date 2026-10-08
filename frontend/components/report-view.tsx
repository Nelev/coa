"use client";

import dynamic from "next/dynamic";

import { useReport } from "@/components/report-context";
import { Skeleton } from "@/components/ui/skeleton";

// json-render, its shadcn components and zod are only needed once a report arrives; upload() preloads this chunk.
const ReportRenderer = dynamic(() => import("@/components/report-renderer").then((m) => m.ReportRenderer));

export function ReportView() {
  const { report } = useReport();

  switch (report.status) {
    case "idle":
      return <p className="text-sm text-muted-foreground">Upload a CoA PDF from the sidebar to generate a report.</p>;
    case "loading":
      return (
        <div className="flex flex-col gap-3" aria-busy="true">
          <p className="text-sm text-muted-foreground">
            Analyzing {report.filename}. This takes about a minute.
          </p>
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      );
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
