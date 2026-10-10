import type { ReactNode } from "react";

// The placeholder of something that is loading: its shapes are hidden from assistive tech, which hears one "Loading…" instead.
export function SkeletonRegion({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <div aria-busy>
      <p role="status" className="sr-only">
        {label}
      </p>
      <div aria-hidden className={className}>
        {children}
      </div>
    </div>
  );
}
