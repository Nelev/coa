import { CircleCheck, CirclePause, CircleX, Clock, FileText, FileX, Loader2, ShieldCheck, ShieldX, TriangleAlert } from "lucide-react";

import type { Decision, Run } from "@/components/report-context";
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

function ChipBadge({ chip: { label, variant, icon }, title, large }: { chip: Chip; title?: string; large?: boolean }) {
  return (
    <Badge variant={variant} title={title} className={large ? "h-8 gap-2 px-3.5 text-sm [&_svg]:size-4" : "h-6 gap-1.5 px-2.5 text-xs"}>
      {icon}
      {label}
    </Badge>
  );
}

export function StatusChip({ run, large }: { run: Run; large?: boolean }) {
  return <ChipBadge chip={chipOf(run)} large={large} />;
}

const DECISIONS: Record<Decision, Chip> = {
  approved: { label: "Approved", variant: "success", icon: <ShieldCheck /> },
  rejected: { label: "Rejected", variant: "destructive", icon: <ShieldX /> },
  on_hold: { label: "On hold", variant: "warning", icon: <CirclePause /> },
};

// what a person decided about the lot; nothing while nobody has
export function DecisionChip({ run, large }: { run: Run; large?: boolean }) {
  if (!run.decision) return null;
  const { label } = DECISIONS[run.decision];
  return <ChipBadge chip={DECISIONS[run.decision]} large={large} title={run.decidedBy ? `${label} by ${run.decidedBy}` : label} />;
}
