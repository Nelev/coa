import { CircleCheck, CircleX, Clock, FileText, FileX, Loader2, TriangleAlert } from "lucide-react";

import type { Run } from "@/components/report-context";
import { Badge } from "@/components/ui/badge";

type Chip = { label: string; variant: "success" | "warning" | "destructive" | "info" | "secondary"; icon: React.ReactNode };

// the icon and the label carry the meaning too, so it never depends on the color alone
function chipOf(run: Run): Chip {
  switch (run.state) {
    case "queued":
      return { label: "Queued", variant: "secondary", icon: <Clock /> };
    case "loading":
      return { label: "Analyzing", variant: "info", icon: <Loader2 className="animate-spin motion-reduce:animate-none" /> };
    case "error":
      return { label: "Failed", variant: "destructive", icon: <CircleX /> };
    case "done":
      // a run analyzed before results were stored: its report is there, its verdict is not known here
      if (!run.result) return { label: "Check report", variant: "secondary", icon: <FileText /> };
      switch (run.result.outcome) {
        case "Non-conforming":
          return { label: "Non-conforming", variant: "destructive", icon: <CircleX /> };
        case "Needs review":
          return { label: "Needs review", variant: "warning", icon: <TriangleAlert /> };
        case "Not a CoA":
          return { label: "Not a CoA", variant: "warning", icon: <FileX /> };
        case "Conforming":
          return { label: "Conforming", variant: "success", icon: <CircleCheck /> };
      }
  }
}

export function StatusChip({ run }: { run: Run }) {
  const { label, variant, icon } = chipOf(run);
  return (
    <Badge variant={variant} className="h-6 gap-1.5 px-2.5 text-xs">
      {icon}
      {label}
    </Badge>
  );
}
