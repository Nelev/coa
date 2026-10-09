"use client";

import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react";

import { isActive } from "@/lib/runs";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

const POLL_MS = 1000;

export type Outcome = "Conforming" | "Needs review" | "Non-conforming" | "Not a CoA";

// what the list shows of a finished analysis, without the report
export type RunResult = {
  outcome: Outcome;
  counts: { pass: number; fail: number; review: number };
  product: string | null;
  lot: string | null;
  supplier: string | null;
};

// statuses: what the agent reported while it worked, in order; the last one is what it is doing now.
// queued: waiting on the server for a free worker; error: `message` says why, `statuses` how far the agent got.
// startedAt / finishedAt: when the server started and ended the run, as Date.now() values (0 while that has not happened).
// local: the run is not on the server (an upload that failed), so there is no report page for it.
export type Run = {
  id: string;
  filename: string;
  state: "queued" | "loading" | "done" | "error";
  startedAt: number;
  finishedAt: number;
  statuses: string[];
  result?: RunResult;
  message?: string;
  local?: boolean;
};

// a job as GET /jobs returns it; the report (ui_spec) is only in GET /jobs/{id}
export type Job = {
  id: string;
  filename: string;
  status: "queued" | "running" | "done" | "error";
  statuses: string[];
  error: string | null;
  started_at: number | null;
  finished_at: number | null;
  result: RunResult | null;
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
    finishedAt: job.finished_at ?? 0,
    statuses: job.statuses,
    result: job.result ?? undefined,
    message: job.error ?? undefined,
  };
  const unchanged =
    previous?.state === run.state &&
    previous.statuses.length === run.statuses.length &&
    previous.message === run.message &&
    previous.startedAt === run.startedAt &&
    previous.finishedAt === run.finishedAt;
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

// the reports seen so far: one of a finished run never changes, so opening it again (previous / next, back to the list) costs nothing
const reports = new Map<string, unknown>();

// the report of a finished run; null while the job has none yet
export async function fetchReport(id: string): Promise<unknown> {
  if (reports.has(id)) return reports.get(id);
  const job = (await request(`/jobs/${id}`).then((response) => response.json())) as Job;
  if (job.ui_spec != null) reports.set(id, job.ui_spec);
  return job.ui_spec;
}

// the server's jobs replace what we know of them; runs the server does not have (an upload that failed) stay
function merge(jobs: Job[], runs: Run[]): Run[] {
  const known = new Map(runs.map((run) => [run.id, run]));
  const onServer = new Set(jobs.map((job) => job.id));
  const merged = [...jobs.map((job) => toRun(job, known.get(job.id))), ...runs.filter((run) => !onServer.has(run.id))];
  return merged.length === runs.length && merged.every((run, i) => run === runs[i]) ? runs : merged;
}

// the renderer chunk (json-render, shadcn components, zod) is big: load it before a report is opened
export const preloadReport = () => void import("@/components/report-renderer");

const isPdf = (file: File) => file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");

const ReportContext = createContext<{
  runs: Run[];
  // how many runs are queued or being analyzed
  running: number;
  // false until the first answer of the server (or its first failure), so a page can tell "loading" from "no such run"
  loaded: boolean;
  // the server could not be reached by the last request
  offline: boolean;
  // something the user should know about their last upload, e.g. files that were skipped
  notice: string | null;
  dismissNotice: () => void;
  upload: (files: File[]) => void;
} | null>(null);

// Holds the runs shared by every page. The server queues and runs the jobs; this polls it for their progress while any is
// unfinished, and loads the list again when the page opens, so a reload loses nothing.
export function ReportProvider({ children }: { children: ReactNode }) {
  const [runs, setRuns] = useState<Run[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [offline, setOffline] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const running = runs.filter(isActive).length;
  const polling = running > 0;
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlight.current) return; // a slow answer must not pile requests up
    inFlight.current = true;
    try {
      const jobs = await fetchJobs();
      setRuns((all) => merge(jobs, all));
      setOffline(false);
    } catch {
      setOffline(true); // keep what we show and try again
    } finally {
      inFlight.current = false;
    }
  }, []);

  // restore the runs of an earlier visit
  useEffect(() => {
    refresh().finally(() => setLoaded(true));
  }, [refresh]);

  useEffect(() => {
    if (!polling) return;
    const timer = setInterval(refresh, POLL_MS);
    return () => clearInterval(timer);
  }, [polling, refresh]);

  async function uploadOne(file: File): Promise<Run> {
    try {
      const body = new FormData();
      body.append("file", file);
      return toRun(await request("/jobs", { method: "POST", body }).then((response) => response.json()));
    } catch (error) {
      const message = error instanceof Error ? error.message : "the upload failed";
      return {
        id: crypto.randomUUID(),
        filename: file.name,
        state: "error",
        startedAt: 0,
        finishedAt: Date.now(),
        statuses: [],
        message,
        local: true,
      };
    }
  }

  function upload(files: File[]) {
    const pdfs = files.filter(isPdf);
    const skipped = files.length - pdfs.length;
    if (skipped > 0) setNotice(`${skipped} ${skipped === 1 ? "file was" : "files were"} skipped: only PDF documents can be analyzed.`);
    if (pdfs.length === 0) return;
    preloadReport(); // while the agent runs
    for (const file of pdfs) {
      void uploadOne(file).then((run) => setRuns((all) => [...all, run]));
    }
  }

  return <ReportContext value={{ runs, running, loaded, offline, notice, dismissNotice: () => setNotice(null), upload }}>{children}</ReportContext>;
}

export function useReport() {
  const context = useContext(ReportContext);
  if (!context) throw new Error("useReport must be used inside <ReportProvider>");
  return context;
}
