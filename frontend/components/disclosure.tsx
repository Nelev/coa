import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

// a native <details>: it opens and closes with the keyboard and is announced as a disclosure, with no script
export function Summary({ className, children }: { className: string; children: ReactNode }) {
  return (
    <summary
      className={cn(
        "flex w-full cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden",
        className,
      )}
    >
      {children}
      <ChevronDown aria-hidden className="size-4 shrink-0 transition-transform group-open/details:rotate-180" />
    </summary>
  );
}
