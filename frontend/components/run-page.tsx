"use client";

import { ArrowLeft, ChevronLeft, ChevronRight } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { fetchReport, type Run, useReport } from "@/components/report-context";
import { RunProgress } from "@/components/run-progress";
import { StatusChip } from "@/components/status-chip";
import { Steps } from "@/components/steps";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { isActive, sortRuns } from "@/lib/runs";

// json-render, its shadcn components and zod are only needed once a report arrives; upload() preloads this chunk.
const ReportRenderer = dynamic(() => import("@/components/report-renderer").then((m) => m.ReportRenderer));

// The report is asked for as soon as the page opens, in parallel with the list of runs instead of after it (`state` is
// undefined until the list says what the run is). Once the list says it is not done there is nothing to ask for, and the
// request is made when it finishes.
function useReportSpec(id: string, state: Run["state"] | undefined) {
  const done = state === "done";
  const wanted = state === undefined || done;
  const [loaded, setLoaded] = useState<{ id: string; spec: unknown }>();
  const [failed, setFailed] = useState(false);
  const have = loaded?.id === id;

  useEffect(() => {
    if (have || !wanted) return;
    let current = true;
    setFailed(false);
    fetchReport(id)
      .then((spec) => current && spec != null && setLoaded({ id, spec }))
      .catch(() => current && done && setFailed(true)); // before the run is done there is no report to miss
    return () => {
      current = false;
    };
  }, [id, done, wanted, have]);

  return { spec: loaded?.id === id ? loaded.spec : undefined, failed };
}

function Report({ run, spec, failed }: { run: Run; spec: unknown; failed: boolean }) {
  if (isActive(run)) {
    return (
      <div className="flex max-w-md flex-col gap-3 rounded-xl bg-card p-5 ring-1 ring-foreground/10">
        <p className="text-sm text-muted-foreground">The report appears here when the analysis finishes.</p>
        <RunProgress run={run} />
      </div>
    );
  }
  if (run.state === "error") {
    return (
      <p role="alert" className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
        {run.filename} could not be analyzed: {run.message}. The steps it reached are in Activity.
      </p>
    );
  }
  if (failed) {
    return (
      <p role="alert" className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
        The report could not be loaded. Is the backend running?
      </p>
    );
  }
  if (spec === undefined) return <Skeleton className="h-64 w-full" />;
  return <ReportRenderer spec={spec} />;
}

function Neighbours({ runs, id }: { runs: Run[]; id: string }) {
  const list = sortRuns(
    runs.filter((run) => !run.local),
    "priority",
  );
  const at = list.findIndex((run) => run.id === id);
  const [previous, next] = [list[at - 1], list[at + 1]];
  const step = (run: Run | undefined, label: string, icon: React.ReactNode) =>
    run ? (
      <Button variant="outline" size="icon" aria-label={`${label}: ${run.filename}`} render={<Link href={`/runs/${run.id}`} />} nativeButton={false}>
        {icon}
      </Button>
    ) : (
      <Button variant="outline" size="icon" aria-label={label} disabled>
        {icon}
      </Button>
    );
  return (
    <fieldset className="flex min-w-0 items-center gap-2">
      <legend className="sr-only">Other runs, most urgent first</legend>
      <span className="text-xs text-subtle-foreground tabular-nums">
        {at + 1} of {list.length}
      </span>
      {step(previous, "Previous run", <ChevronLeft />)}
      {step(next, "Next run", <ChevronRight />)}
    </fieldset>
  );
}

export function RunPage() {
  const { id } = useParams<{ id: string }>();
  const { runs, loaded } = useReport();
  const [chosen, setChosen] = useState<string>();
  const run = runs.find((r) => r.id === id);
  const { spec, failed } = useReportSpec(id, run?.state);

  const back = (
    <Link
      href="/"
      className="inline-flex w-fit items-center gap-1.5 rounded-md text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
    >
      <ArrowLeft className="size-4" />
      All runs
    </Link>
  );

  if (!run) {
    return (
      <div className="flex flex-col gap-6">
        {back}
        {loaded ? (
          <p className="text-sm text-muted-foreground">There is no run with this address. It may have been removed.</p>
        ) : (
          <Skeleton className="h-24 w-full" />
        )}
      </div>
    );
  }

  // while the analysis runs its steps are what there is to see; the report takes over when it is done, unless the user chose
  const tab = chosen ?? (run.state === "done" ? "report" : "activity");

  return (
    <div className="flex flex-col gap-6">
      {back}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="max-w-full truncate text-xl font-semibold">{run.filename}</h1>
            <StatusChip run={run} />
          </div>
        </div>
        <Neighbours runs={runs} id={run.id} />
      </div>

      <Tabs value={tab} onValueChange={(value) => setChosen(String(value))}>
        <TabsList>
          <TabsTrigger value="report">Report</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
        </TabsList>
        <TabsContent value="report">
          <Report run={run} spec={spec} failed={failed} />
        </TabsContent>
        <TabsContent value="activity">
          <Steps run={run} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
