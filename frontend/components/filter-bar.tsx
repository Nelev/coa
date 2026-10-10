import type { Filter, Tally } from "@/lib/runs";
import { cn } from "@/lib/utils";

const OPTIONS: { filter: Filter; label: string; count: (tally: Tally) => number }[] = [
  { filter: "all", label: "All runs", count: (t) => t.all },
  { filter: "attention", label: "Needs attention", count: (t) => t.attention },
  { filter: "progress", label: "In progress", count: (t) => t.progress },
  { filter: "conforming", label: "Conforming", count: (t) => t.conforming },
  { filter: "decision", label: "Awaiting decision", count: (t) => t.awaiting },
];

export const FILTER_LABELS = Object.fromEntries(OPTIONS.map(({ filter, label }) => [filter, label])) as Record<Filter, string>;

// The filters of the list, with their counts. Pressing the one that is on shows all runs again. On a phone the row scrolls
// sideways inside its own box, so the page never does.
export function FilterBar({ tally, filter, onChange }: { tally: Tally; filter: Filter; onChange: (filter: Filter) => void }) {
  return (
    <fieldset className="min-w-0">
      <legend className="sr-only">Filter runs</legend>
      <div className="-mx-4 overflow-x-auto px-4 py-1 [scrollbar-width:thin] md:mx-0 md:px-0">
        <div className="flex w-max gap-1 rounded-xl bg-muted p-1">
          {OPTIONS.map(({ filter: value, label, count }) => {
            const pressed = filter === value;
            return (
              <button
                key={value}
                type="button"
                aria-pressed={pressed}
                onClick={() => onChange(pressed ? "all" : value)}
                className={cn(
                  "flex h-8 items-center gap-2 rounded-lg px-3 text-sm font-medium whitespace-nowrap text-muted-foreground outline-none transition-colors pointer-coarse:h-10 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
                  pressed && "bg-card text-foreground shadow-sm ring-1 ring-foreground/10",
                )}
              >
                {label}
                <span className={cn("rounded-md px-1.5 text-xs tabular-nums", pressed ? "bg-primary/15 text-primary" : "bg-foreground/5")}>
                  {count(tally)}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </fieldset>
  );
}
