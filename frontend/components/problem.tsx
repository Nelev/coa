import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

// A problem says what happened, what is safe, and what to do about it (`action` is a button, not a hint). It is announced when it appears.
// `compact` is for one inside a form or a dialog, where the page's own padding would be too much.
export function Problem({
  children,
  action,
  icon: Icon,
  compact,
}: {
  children: ReactNode;
  action?: ReactNode;
  icon?: LucideIcon;
  compact?: boolean;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg bg-destructive/10 text-sm text-destructive",
        compact ? "px-3 py-2" : "px-4 py-3",
      )}
    >
      {Icon ? <Icon aria-hidden className="size-4 shrink-0" /> : null}
      <p className="min-w-0 flex-1 basis-60">{children}</p>
      {action}
    </div>
  );
}
