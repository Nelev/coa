"use client";

import { Search, WifiOff, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { FilterTiles } from "@/components/filter-tiles";
import { useReport } from "@/components/report-context";
import { RunRow } from "@/components/run-row";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { UploadButton } from "@/components/upload-button";
import { type Filter, type Sort, tally, visibleRuns } from "@/lib/runs";

// j / k move between the rows, Enter opens the focused one (they are links)
function useRowKeys(list: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement;
      if (event.metaKey || event.ctrlKey || event.altKey || target.closest("input, textarea, select, [contenteditable]")) return;
      if (event.key !== "j" && event.key !== "k") return;
      const rows = Array.from(list.current?.querySelectorAll<HTMLElement>("[data-row]") ?? []);
      const at = rows.indexOf(document.activeElement as HTMLElement);
      const next = rows[event.key === "j" ? Math.min(at + 1, rows.length - 1) : Math.max(at - 1, 0)];
      next?.focus();
      event.preventDefault();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [list]);
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-16 text-center">
      <h2 className="text-lg font-semibold">Analyze your first Certificate of Analysis</h2>
      <p className="max-w-md text-sm text-muted-foreground">
        Drop PDF certificates anywhere on this page, or pick them from your computer. Each one is checked against the plant specification, and you see
        which lots need attention.
      </p>
      <div className="w-48">
        <UploadButton />
      </div>
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="flex flex-col gap-px overflow-hidden rounded-xl ring-1 ring-foreground/10" aria-hidden>
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-16 rounded-none" />
      ))}
    </div>
  );
}

export function Overview() {
  const { runs, loaded, offline, notice, dismissNotice } = useReport();
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("priority");
  const [query, setQuery] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const list = useRef<HTMLUListElement>(null);
  useRowKeys(list);

  // keeps "2 min ago" current without re-rendering every second
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const shown = visibleRuns(runs, filter, query, sort);

  return (
    <div className="flex flex-col gap-5">
      {offline && (
        <p role="alert" className="flex items-center gap-2 rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <WifiOff className="size-4 shrink-0" />
          The server cannot be reached. What you see may be out of date; it keeps trying.
        </p>
      )}
      {notice && (
        <p role="status" className="flex items-center justify-between gap-2 rounded-lg bg-warning/10 px-4 py-3 text-sm text-warning">
          {notice}
          <Button variant="ghost" size="icon-xs" aria-label="Dismiss" onClick={dismissNotice}>
            <X />
          </Button>
        </p>
      )}

      {!loaded ? (
        <ListSkeleton />
      ) : runs.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          <FilterTiles tally={tally(runs)} filter={filter} onChange={setFilter} />

          <div className="flex flex-wrap items-center gap-3">
            <div className="relative min-w-48 flex-1 sm:max-w-sm">
              <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-subtle-foreground" />
              <Input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search file, product, lot or supplier"
                aria-label="Search runs"
                className="h-9 pl-8"
              />
            </div>
            <label className="ml-auto flex items-center gap-2 text-sm text-muted-foreground">
              Sort
              <select
                value={sort}
                onChange={(event) => setSort(event.target.value as Sort)}
                className="h-9 rounded-lg border border-input bg-card px-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="priority">Priority</option>
                <option value="newest">Newest</option>
              </select>
            </label>
          </div>

          {shown.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-12 text-center">
              <p className="text-sm text-muted-foreground">No runs match{query ? ` “${query}”` : " this filter"}.</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setFilter("all");
                  setQuery("");
                }}
              >
                Show all runs
              </Button>
            </div>
          ) : (
            <ul ref={list} className="divide-y overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10" aria-label="Runs">
              {shown.map((run) => (
                <li key={run.id} className="[contain-intrinsic-size:auto_4.5rem] [content-visibility:auto]">
                  <RunRow run={run} now={now} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
