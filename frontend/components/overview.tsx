"use client";

import { Search } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useDeferredValue, useEffect, useState } from "react";

import { ClearRuns } from "@/components/clear-runs";
import { FILTER_LABELS, FilterBar } from "@/components/filter-bar";
import { useReport } from "@/components/report-context";
import { RunsTable } from "@/components/runs-table";
import { SkeletonRegion } from "@/components/skeleton-region";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { UploadButton } from "@/components/upload-button";
import { type Filter, parseFilter, parseSort, SORT_LABELS, type Sort, tally, visibleRuns } from "@/lib/runs";

// the address says which filter and sort are on (so a link can point at "in progress"); it changes without a round trip to the server
function setParam(key: string, value: string, fallback: string) {
  const next = new URLSearchParams(window.location.search);
  if (value === fallback) next.delete(key);
  else next.set(key, value);
  const query = next.toString();
  window.history.replaceState(null, "", query ? `?${query}` : window.location.pathname);
}

const SAMPLES = [
  { file: "sample_coa_citric_acid.pdf", label: "Try a sample certificate" },
  { file: "sample_coa_defective.pdf", label: "Try one with defects" },
];

function EmptyState() {
  const { upload } = useReport();
  const [failed, setFailed] = useState(false);

  async function trySample(file: string) {
    setFailed(false);
    try {
      const response = await fetch(`/samples/${file}`);
      if (!response.ok) throw new Error(String(response.status));
      upload([new File([await response.blob()], file, { type: "application/pdf" })]);
    } catch {
      setFailed(true);
    }
  }

  return (
    <div className="flex flex-col items-center gap-4 rounded-2xl border border-dashed px-6 py-16 text-center">
      <h2 className="text-lg font-semibold">Analyze your first Certificate of Analysis</h2>
      <p className="max-w-md text-sm text-muted-foreground">
        Drop PDF certificates anywhere on this page, or pick them from your computer. Each one is checked against the plant specification, and you see
        which lots need attention.
      </p>
      <div className="w-48">
        <UploadButton />
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        {SAMPLES.map(({ file, label }) => (
          <Button key={file} variant="outline" size="sm" onClick={() => trySample(file)}>
            {label}
          </Button>
        ))}
      </div>
      {failed ? (
        <p role="alert" className="text-sm text-destructive">
          The sample could not be loaded.
        </p>
      ) : null}
    </div>
  );
}

// The shape of the page while the first answer is on its way: the attention card, the filters, the search and a few rows, so that
// nothing jumps when the runs arrive.
function OverviewSkeleton() {
  return (
    <SkeletonRegion label="Loading runs…" className="flex flex-col gap-5">
      <Skeleton className="h-10 w-full max-w-xl rounded-xl" />
      <Skeleton className="h-9 w-full max-w-sm rounded-lg" />
      <div className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-4 border-b px-4 py-4 last:border-b-0">
            <Skeleton className="h-6 w-28 rounded-full" />
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-1/3" />
            </div>
            <Skeleton className="hidden h-4 w-24 md:block" />
          </div>
        ))}
      </div>
    </SkeletonRegion>
  );
}

export function Overview() {
  const { runs, loaded, retryUpload, dismissRun } = useReport();
  const params = useSearchParams();
  const filter = parseFilter(params.get("filter"));
  const sort = parseSort(params.get("sort"));
  const [query, setQuery] = useState("");
  const [now, setNow] = useState(() => Date.now());

  // keeps "2 min ago" current without re-rendering every second
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const changeFilter = (value: Filter) => setParam("filter", value, "all");
  const changeSort = (value: Sort) => setParam("sort", value, "priority");
  // typing stays responsive however long the list is: the filtering follows a moment behind the field
  const deferredQuery = useDeferredValue(query);
  const shown = visibleRuns(runs, filter, deferredQuery, sort);
  const counts = tally(runs);

  return (
    <div className="flex flex-col gap-5">
      {!loaded ? (
        <OverviewSkeleton />
      ) : runs.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          <FilterBar tally={counts} filter={filter} onChange={changeFilter} />

          <div className="flex flex-wrap items-center gap-3">
            <div className="relative min-w-48 flex-1 sm:max-w-sm">
              <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-subtle-foreground" />
              <Input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search file, product, lot or supplier"
                aria-label="Search runs"
                className="h-9 pl-8 pointer-coarse:h-10"
              />
            </div>
            {/* the column headers sort on a wide screen; the phone layout has no headers */}
            <label className="flex items-center gap-2 text-sm text-muted-foreground md:hidden">
              Sort
              <select
                value={sort}
                onChange={(event) => changeSort(parseSort(event.target.value))}
                className="h-10 rounded-lg border border-field bg-card px-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {Object.entries(SORT_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <div className="ml-auto flex items-center gap-2">
              <p role="status" className="text-sm text-muted-foreground tabular-nums">
                {shown.length === runs.length ? `${runs.length} ${runs.length === 1 ? "run" : "runs"}` : `${shown.length} of ${runs.length} runs`}
                {filter !== "all" && <span className="sr-only"> ({FILTER_LABELS[filter]})</span>}
              </p>
              <ClearRuns />
            </div>
          </div>

          {shown.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-12 text-center">
              <p className="text-sm text-muted-foreground">No runs match{deferredQuery ? ` “${deferredQuery}”` : " this filter"}.</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  changeFilter("all");
                  setQuery("");
                }}
              >
                Show all runs
              </Button>
            </div>
          ) : (
            <RunsTable runs={shown} now={now} sort={sort} onSort={changeSort} onRetry={retryUpload} onDismiss={dismissRun} />
          )}
        </>
      )}
    </div>
  );
}
