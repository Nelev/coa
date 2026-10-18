"use client";

import { ChevronLeft, ChevronRight, FileText } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { AnswerPanel } from "@/components/answer-panel";
import { DecisionBar } from "@/components/decision-bar";
import { DecisionPanel } from "@/components/decision-panel";
import { Problem } from "@/components/problem";
import { fetchReport, openPdf, type Run, useReport } from "@/components/report-context";
import { RunSummary, runTitle } from "@/components/run-summary";
import { SkeletonRegion } from "@/components/skeleton-region";
import { Steps } from "@/components/steps";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { isActive, isWaiting, sortRuns } from "@/lib/runs";

// json-render, its shadcn components and zod are only needed once a report arrives; upload() preloads this chunk.
const ReportRenderer = dynamic(() => import("@/components/report-renderer").then((m) => m.ReportRenderer));

// The report is asked for as soon as the page opens, in parallel with the list of runs instead of after it (`state` is
// undefined until the list says what the run is). Once the list says it is not done there is nothing to ask for, and the
// request is made when it finishes.
function useReportSpec(id: string, state: Run["state"] | undefined) {
  const [attempt, setAttempt] = useState(0); // asking again after a failure
  const done = state === "done";
  const wanted = state === undefined || done;
  const [loaded, setLoaded] = useState<{ id: string; spec: unknown }>();
  const [failed, setFailed] = useState(false);
  const have = loaded?.id === id;

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` is only there to ask again after a failure
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
  }, [id, done, wanted, have, attempt]);

  return { spec: loaded?.id === id ? loaded.spec : undefined, failed, retry: () => setAttempt((n) => n + 1) };
}

// the shape of a report while it loads: the title, the verdict, two cards and a list of findings
function ReportSkeleton() {
  return (
    <SkeletonRegion label="Loading the report…" className="flex max-w-4xl flex-col gap-5">
      <Skeleton className="h-7 w-2/3" />
      <Skeleton className="h-16 w-full rounded-xl" />
      <div className="grid gap-4 sm:grid-cols-2">
        <Skeleton className="h-32 rounded-xl" />
        <Skeleton className="h-32 rounded-xl" />
      </div>
      <Skeleton className="h-6 w-32" />
      <Skeleton className="h-20 w-full rounded-xl" />
      <Skeleton className="h-20 w-full rounded-xl" />
    </SkeletonRegion>
  );
}

function Report({
  run,
  spec,
  failed,
  retry,
  showActivity,
}: {
  run: Run;
  spec: unknown;
  failed: boolean;
  retry: () => void;
  showActivity: () => void;
}) {
  if (isWaiting(run)) {
    return <p className="text-sm text-muted-foreground">The agent is waiting for your answer above. The report appears when it has finished.</p>;
  }
  if (isActive(run)) {
    return (
      <p className="text-sm text-muted-foreground">
        The report appears here when the analysis finishes. Its progress is above, and every step is in Activity.
      </p>
    );
  }
  if (run.state === "error") {
    return (
      <Problem
        action={
          <Button variant="outline" size="sm" onClick={showActivity}>
            See the steps
          </Button>
        }
      >
        {run.filename} could not be analyzed: {run.message}. Nothing else is affected; upload the file again once the cause is fixed.
      </Problem>
    );
  }
  if (failed) {
    return (
      <Problem
        action={
          <Button variant="outline" size="sm" onClick={retry}>
            Try again
          </Button>
        }
      >
        The report could not be loaded, probably because the server cannot be reached. The analysis itself is saved on the server.
      </Problem>
    );
  }
  if (spec === undefined) return <ReportSkeleton />;
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

// the certificate needs the access token, so it is opened by a click handler instead of a link; a refusal is shown beside the button
function OpenPdfButton({ id }: { id: string }) {
  const [error, setError] = useState<string>();
  return (
    <>
      {error ? (
        <span role="alert" className="text-sm text-destructive">
          {error}
        </span>
      ) : null}
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          setError(undefined);
          openPdf(id).catch((reason) => setError(reason instanceof Error ? reason.message : "the certificate could not be opened"));
        }}
      >
        <FileText />
        Open the CoA
      </Button>
    </>
  );
}

export function RunPage() {
  const { id } = useParams<{ id: string }>();
  const { runs, loaded } = useReport();
  const run = runs.find((r) => r.id === id);
  const { spec, failed, retry } = useReportSpec(id, run?.state);
  return <RunView run={run} runs={runs} loaded={loaded} spec={spec} failed={failed} retry={retry} />;
}

// What the page shows, given the run and its report; RunPage fetches them.
export function RunView({
  run,
  runs,
  loaded,
  spec,
  failed,
  retry,
}: {
  run: Run | undefined;
  runs: Run[];
  loaded: boolean;
  spec: unknown;
  failed: boolean;
  retry: () => void;
}) {
  const [chosen, setChosen] = useState<string>();

  const crumbs = (current: string) => (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink render={<Link href="/" />}>Runs</BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem className="min-w-0">
          <BreadcrumbPage className="block max-w-[60vw] truncate">{current}</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  );

  if (!run) {
    return (
      <div className="flex flex-col gap-6">
        {crumbs("Run")}
        {loaded ? (
          <p className="text-sm text-muted-foreground">There is no run with this address. It may have been removed.</p>
        ) : (
          <SkeletonRegion label="Loading the run…" className="flex flex-col gap-5">
            <Skeleton className="h-8 w-2/3" />
            <Skeleton className="h-36 w-full rounded-2xl" />
            <Skeleton className="h-9 w-48" />
          </SkeletonRegion>
        )}
      </div>
    );
  }

  // while the analysis runs its steps are what there is to see; the report takes over when it is done, unless the user chose
  const tab = chosen ?? (run.state === "done" ? "report" : "activity");
  const decidable = run.state === "done";

  return (
    <div className={decidable ? "flex flex-col gap-6 pb-20 lg:pb-0" : "flex flex-col gap-6"}>
      {crumbs(runTitle(run))}
      <RunSummary
        run={run}
        actions={
          <>
            {run.hasPdf && <OpenPdfButton id={run.id} />}
            <Neighbours runs={runs} id={run.id} />
          </>
        }
      />

      {isWaiting(run) && run.question && <AnswerPanel key={run.question.id} run={run} />}

      {/* from lg on, the decision is a column that stays in view beside the report; below, it is a bar at the foot of the screen */}
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Tabs value={tab} onValueChange={(value) => setChosen(String(value))} className="min-w-0">
          <TabsList>
            <TabsTrigger value="report">Report</TabsTrigger>
            <TabsTrigger value="activity">Activity</TabsTrigger>
          </TabsList>
          <TabsContent value="report" className="flex flex-col gap-6">
            <Report run={run} spec={spec} failed={failed} retry={retry} showActivity={() => setChosen("activity")} />
          </TabsContent>
          <TabsContent value="activity">
            <Steps run={run} />
          </TabsContent>
        </Tabs>
        {decidable && (
          <div className="sticky top-[4.5rem] hidden lg:block">
            <DecisionPanel run={run} />
          </div>
        )}
      </div>
      {decidable && <DecisionBar run={run} />}
    </div>
  );
}
