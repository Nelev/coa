import { Check, Clock, Loader2, X } from "lucide-react";

import type { Run } from "@/components/report-context";

// static, so created once instead of on every render of every row
const ICONS: Record<Run["state"], React.ReactNode> = {
  queued: <Clock className="size-4 text-muted-foreground" />,
  loading: <Loader2 className="size-4 animate-spin text-info motion-reduce:animate-none" />,
  done: <Check className="size-4 text-success" />,
  error: <X className="size-4 text-destructive" />,
};

export function RunIcon({ state }: { state: Run["state"] }) {
  return ICONS[state];
}
