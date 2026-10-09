"use client";

import { createContext, type ReactNode, useContext, useEffect, useState } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

const POLL_MS = 1000;

// statuses: what the agent reported while it worked, in order; the last one is what it is doing now.
// queued: waiting on the server for a free worker; error: `message` says why, `statuses` how far the agent got.
// startedAt: when the server started the run, as a Date.now() value.
export type Run = {
  id: string;
  filename: string;
  state: "queued" | "loading" | "done" | "error";
  startedAt: number;
  statuses: string[];
  spec?: unknown;
  message?: string;
};

// a job as GET /jobs returns it; the report (ui_spec) is only in GET /jobs/{id}
type Job = {
  id: string;
  filename: string;
  status: "queued" | "running" | "done" | "error";
  statuses: string[];
  error: string | null;
  started_at: number | null;
  ui_spec?: unknown;
};

const STATES = { queued: "queued", running: "loading", done: "done", error: "error" } as const;

// a run that did not change keeps its object, so a poll that brings nothing new re-renders nothing
function toRun(job: Job, previous?: Run): Run {
  const run: Run = {
    id: job.id,
    filename: job.filename,
    state: STATES[job.status],
    startedAt: job.started_at ?? 0,
    statuses: job.statuses,
    message: job.error ?? undefined,
    spec: previous?.spec,
  };
  const unchanged =
    previous?.state === run.state &&
    previous.statuses.length === run.statuses.length &&
    previous.message === run.message &&
    previous.startedAt === run.startedAt;
  return unchanged ? previous : run;
}

async function request(path: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(`${API_URL}${path}`, init);
  if (!response.ok) throw new Error(`the server answered ${response.status}`);
  return response;
}

function fetchJobs(): Promise<Job[]> {
  return request("/jobs").then((response) => response.json());
}

// the server's jobs replace what we know of them; runs the server does not have (an upload that failed) stay
function merge(jobs: Job[], runs: Run[]): Run[] {
  const known = new Map(runs.map((run) => [run.id, run]));
  const onServer = new Set(jobs.map((job) => job.id));
  const merged = [...jobs.map((job) => toRun(job, known.get(job.id))), ...runs.filter((run) => !onServer.has(run.id))];
  return merged.length === runs.length && merged.every((run, i) => run === runs[i]) ? runs : merged;
}

const ReportContext = createContext<{
  runs: Run[];
  selectedId: string | null;
  select: (id: string) => void;
  upload: (files: File[]) => void;
} | null>(null);

// Holds the runs shared by the sidebar and the page content. The server queues and runs the jobs; this polls it for their
// progress while any is unfinished, and loads the list again when the page opens, so a reload loses nothing.
export function ReportProvider({ children }: { children: ReactNode }) {
  const [runs, setRuns] = useState<Run[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const polling = runs.some((run) => run.state === "queued" || run.state === "loading");
  const selected = runs.find((run) => run.id === selectedId);
  const needsSpec = selected?.state === "done" && selected.spec === undefined;

  // restore the runs of an earlier visit, selecting the latest
  useEffect(() => {
    fetchJobs()
      .then((jobs) => {
        setRuns((all) => merge(jobs, all));
        setSelectedId((current) => current ?? jobs.at(-1)?.id ?? null);
      })
      .catch(() => {}); // the server is unreachable: the page starts empty
  }, []);

  useEffect(() => {
    if (!polling) return;
    const timer = setInterval(() => {
      fetchJobs()
        .then((jobs) => setRuns((all) => merge(jobs, all)))
        .catch(() => {}); // the server is unreachable for now: keep what we show and try again
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [polling]);

  // the list has no reports: fetch the selected one when its job is done
  useEffect(() => {
    if (!needsSpec) return;
    request(`/jobs/${selectedId}`)
      .then((response) => response.json() as Promise<Job>)
      .then((job) => setRuns((all) => all.map((run) => (run.id === selectedId ? { ...run, spec: job.ui_spec } : run))))
      .catch(() => {}); // fetched again when the run is selected again
  }, [needsSpec, selectedId]);

  async function uploadOne(file: File): Promise<Run> {
    try {
      const body = new FormData();
      body.append("file", file);
      return toRun(await request("/jobs", { method: "POST", body }).then((response) => response.json()));
    } catch (error) {
      const message = error instanceof Error ? error.message : "the upload failed";
      return { id: crypto.randomUUID(), filename: file.name, state: "error", startedAt: 0, statuses: [], message };
    }
  }

  function upload(files: File[]) {
    if (files.length === 0) return;
    void import("@/components/report-renderer"); // preload the renderer chunk while the agent runs
    for (const file of files) {
      void uploadOne(file).then((run) => {
        setRuns((all) => [...all, run]);
        setSelectedId((current) => current ?? run.id); // don't pull the user away from a report they are reading
      });
    }
  }

  return <ReportContext value={{ runs, selectedId, select: setSelectedId, upload }}>{children}</ReportContext>;
}

export function useReport() {
  const context = useContext(ReportContext);
  if (!context) throw new Error("useReport must be used inside <ReportProvider>");
  return context;
}
