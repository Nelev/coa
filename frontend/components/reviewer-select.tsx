"use client";

import { useId } from "react";

import { usePersistedChoice } from "@/lib/use-persisted-choice";

// the demo has no login: whoever decides or answers says who they are
const REVIEWERS = ["QA Anna Rossi", "QC Marco Bianchi"] as const;

// the style of the text fields of the forms
export const FIELD =
  "w-full rounded-lg border border-field bg-transparent px-2.5 py-1.5 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:bg-input/30";

// who acts: the same person every time (WCAG 3.3.7: do not ask for the same thing twice), kept between visits and across the forms
export function useReviewer() {
  return usePersistedChoice("reviewer", REVIEWERS);
}

export function ReviewerSelect({ label, by, onChange }: { label: string; by: string; onChange: (name: (typeof REVIEWERS)[number]) => void }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-xs font-medium text-muted-foreground">
        {label}
      </label>
      <select
        id={id}
        value={by}
        onChange={(event) => onChange(REVIEWERS.find((name) => name === event.target.value) ?? REVIEWERS[0])}
        className={`${FIELD} h-8 max-w-xs py-0 pointer-coarse:h-10`}
      >
        {REVIEWERS.map((name) => (
          <option key={name}>{name}</option>
        ))}
      </select>
    </div>
  );
}
