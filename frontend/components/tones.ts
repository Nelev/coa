import { CircleCheck, CircleX, Info, type LucideIcon, TriangleAlert } from "lucide-react";

import type { Tone } from "@/lib/toasts";

// the icon and the text color of each kind of message: one table for toasts and for the findings of a report
export const TONE: Record<Tone, { icon: LucideIcon; tint: string }> = {
  success: { icon: CircleCheck, tint: "text-success" },
  info: { icon: Info, tint: "text-info" },
  warning: { icon: TriangleAlert, tint: "text-warning" },
  error: { icon: CircleX, tint: "text-destructive" },
};
