import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";

import type { Run } from "@/components/report-context";
import { RunRow } from "@/components/run-row";
import { nextSort, type Sort } from "@/lib/runs";
import { useMediaQuery } from "@/lib/use-media-query";
import { cn } from "@/lib/utils";

type Column = "status" | "name" | "when";

// which way a column is sorted, for aria-sort and the arrow; undefined when the sort is on another column
function direction(column: Column, sort: Sort): "ascending" | "descending" | "other" | undefined {
  if (column === "status") return sort === "priority" ? "other" : undefined; // most urgent first: not alphabetical, not by date
  if (column === "name") return sort === "name" ? "ascending" : sort === "name-desc" ? "descending" : undefined;
  return sort === "oldest" ? "ascending" : sort === "newest" ? "descending" : undefined;
}

const HEAD =
  "sticky top-14 z-10 border-b bg-card px-4 py-2.5 text-left text-xs font-medium text-muted-foreground first:rounded-tl-xl last:rounded-tr-xl";

function SortHeader({
  column,
  label,
  sort,
  onSort,
  className,
  right,
}: {
  column: Column;
  label: string;
  sort: Sort;
  onSort: (sort: Sort) => void;
  className?: string;
  right?: boolean; // a column of times, aligned to the right edge
}) {
  const dir = direction(column, sort);
  const Icon = dir === "ascending" ? ArrowUp : dir ? ArrowDown : ChevronsUpDown;
  return (
    <th scope="col" aria-sort={dir ?? "none"} className={cn(HEAD, right && "text-right", className)}>
      <button
        type="button"
        onClick={() => onSort(nextSort(sort, column))}
        className={cn(
          "-mx-2 inline-flex h-7 items-center gap-1.5 rounded-md px-2 outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:h-10",
          dir && "text-foreground",
          right && "flex-row-reverse",
        )}
      >
        {label}
        <Icon aria-hidden className={cn("size-3.5", !dir && "opacity-50")} />
      </button>
    </th>
  );
}

// The runs as a real table: column headers a screen reader announces, headers that stay in view and sort on a press. On a phone the
// "Result", "Duration", "Cost" and "Updated" columns go and their content moves under the file name (see RunRow).
export function RunsTable({
  runs,
  now,
  sort,
  onSort,
  onRetry,
  onDismiss,
}: {
  runs: Run[];
  now: number;
  sort: Sort;
  onSort: (sort: Sort) => void;
  onRetry: (id: string) => void;
  onDismiss: (id: string) => void;
}) {
  const wide = useMediaQuery("(min-width: 768px)"); // the same breakpoint as `md:` above
  return (
    <div className="overflow-clip rounded-xl bg-card ring-1 ring-foreground/10">
      <table className="w-full table-fixed border-separate border-spacing-0 text-sm">
        <caption className="sr-only">Runs. Press a column heading to sort by it.</caption>
        <thead>
          <tr>
            <SortHeader column="status" label="Status" sort={sort} onSort={onSort} className="w-36 md:w-40" />
            <SortHeader column="name" label="File" sort={sort} onSort={onSort} className="md:w-[34%]" />
            <th scope="col" className={cn(HEAD, "hidden md:table-cell")}>
              Result
            </th>
            <th scope="col" className={cn(HEAD, "hidden w-24 text-right md:table-cell")}>
              Duration
            </th>
            <th scope="col" className={cn(HEAD, "hidden w-28 text-right md:table-cell")}>
              Cost
            </th>
            <SortHeader column="when" label="Updated" sort={sort} onSort={onSort} right className="hidden w-36 md:table-cell" />
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            <RunRow key={run.id} run={run} now={now} wide={wide} onRetry={onRetry} onDismiss={onDismiss} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
