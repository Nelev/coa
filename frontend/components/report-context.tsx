"use client";

import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react";

import { useToast } from "@/components/toaster";
import { accessToken, forgetAccessToken } from "@/lib/access-token";
import { startPolling } from "@/lib/poll";
import { isActive } from "@/lib/runs";
import { skippedToast, uploadSummary } from "@/lib/uploads";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

// a person's decision on a finished analysis; approved and rejected are final, a lot on hold can be decided again
export type Decision = "approved" | "rejected" | "on_hold";

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
// inputTokens, outputTokens, cost: what the model calls of the run used, and what OpenRouter charged for them in US dollars; each is missing
// until a call reports it (a run from before this was recorded has none, and cost stays missing if the provider does not say).
// decision, decidedBy, decidedAt, reason: what a person decided about the lot (decidedAt as a Date.now() value); hasPdf: the certificate can be opened.
export type Run = {
  id: string;
  filename: string;
  state: "queued" | "loading" | "done" | "error";
  startedAt: number;
  finishedAt: number;
  statuses: string[];
  result?: RunResult;
  message?: string;
  inputTokens?: number;
  outputTokens?: number;
  cost?: number;
  local?: boolean;
  decision?: Decision;
  decidedBy?: string;
  decidedAt?: number;
  reason?: string;
  hasPdf?: boolean;
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
  input_tokens: number | null;
  output_tokens: number | null;
  cost_usd: number | null;
  result: RunResult | null;
  decision: Decision | null;
  decided_by: string | null;
  decided_at: number | null;
  reason: string | null;
  has_pdf: boolean;
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
    inputTokens: job.input_tokens ?? undefined,
    outputTokens: job.output_tokens ?? undefined,
    cost: job.cost_usd ?? undefined,
    decision: job.decision ?? undefined,
    decidedBy: job.decided_by ?? undefined,
    decidedAt: job.decided_at ?? undefined,
    reason: job.reason ?? undefined,
    hasPdf: job.has_pdf,
  };
  const unchanged =
    previous?.state === run.state &&
    previous.statuses.length === run.statuses.length &&
    previous.message === run.message &&
    previous.startedAt === run.startedAt &&
    previous.finishedAt === run.finishedAt &&
    previous.inputTokens === run.inputTokens &&
    previous.outputTokens === run.outputTokens &&
    previous.cost === run.cost &&
    previous.decision === run.decision &&
    previous.decidedAt === run.decidedAt &&
    previous.hasPdf === run.hasPdf;
  return unchanged ? previous : run;
}

// every request carries the access token of the signed-in person; a 401 means it went stale, so it is asked for again once
async function send(path: string, init?: RequestInit): Promise<Response> {
  const token = await accessToken().catch(() => {
    throw new Error("the session could not be refreshed, reload the page to sign in again");
  });
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${token}`);
  return fetch(`${API_URL}${path}`, { ...init, headers }).catch(() => {
    throw new Error("the server cannot be reached");
  });
}

// an error says what the server said (its `detail`), or at least its status
async function request(path: string, init?: RequestInit): Promise<Response> {
  let response = await send(path, init);
  if (response.status === 401) {
    forgetAccessToken();
    response = await send(path, init);
  }
  if (!response.ok) {
    const detail = await response.json().then(
      (body) => body.detail,
      () => undefined,
    );
    throw new Error(typeof detail === "string" ? detail : `the server answered ${response.status}`);
  }
  return response;
}

// the blob URL of each certificate opened so far: an upload never changes, so opening it again costs nothing
const pdfs = new Map<string, string>();

// Opens the uploaded certificate of a run in a new tab. A link cannot carry the access token, so the PDF is fetched with it and
// shown from a blob. The tab is opened first, while the click still counts, and pointed at the blob when it arrives.
export async function openPdf(id: string): Promise<void> {
  const tab = window.open("", "_blank");
  if (!tab) throw new Error("the browser blocked the new tab");
  try {
    let url = pdfs.get(id);
    if (!url) {
      const blob = await request(`/jobs/${id}/pdf`).then((response) => response.blob());
      url = URL.createObjectURL(blob); // not revoked: a tab may be showing it
      pdfs.set(id, url);
    }
    tab.location.href = url;
  } catch (error) {
    tab.close();
    throw error;
  }
}

function fetchJobs(): Promise<Job[]> {
  return request("/jobs").then((response) => response.json());
}

// The requests for reports, kept by run: callers that ask while one is under way share it, and the report of a finished run never
// changes, so opening it again (previous / next, back to the list) costs nothing. A request that failed, or that found no report
// yet, is forgotten so that the next one asks again.
const reports = new Map<string, Promise<unknown>>();

// the report of a finished run; null while the job has none yet
export function fetchReport(id: string): Promise<unknown> {
  const known = reports.get(id);
  if (known) return known;
  const report = request(`/jobs/${id}`)
    .then((response) => response.json() as Promise<Job>)
    .then((job) => {
      if (job.ui_spec == null) reports.delete(id);
      return job.ui_spec;
    })
    .catch((error) => {
      reports.delete(id);
      throw error;
    });
  reports.set(id, report);
  return report;
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
  // asks the server now instead of at the next attempt (which grows longer after each failure)
  retry: () => Promise<void>;
  upload: (files: File[]) => void;
  // tries an upload that failed again, or forgets it (it is not on the server, so there is nothing else to remove)
  retryUpload: (id: string) => void;
  dismissRun: (id: string) => void;
  // records a person's decision on a finished run; rejects with the server's reason when it refuses (a reason is missing, the lot was decided already)
  decide: (id: string, decision: Decision, by: string, reason: string) => Promise<void>;
} | null>(null);

// Holds the runs shared by every page. The server queues and runs the jobs; this polls it for their progress while any is
// unfinished, and loads the list again when the page opens, so a reload loses nothing.
export function ReportProvider({ children }: { children: ReactNode }) {
  const [runs, setRuns] = useState<Run[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [offline, setOffline] = useState(false);
  const { toast } = useToast();
  const wasOffline = useRef(false);
  const failedFiles = useRef(new Map<string, File>()); // the files of uploads that failed, to try them again; not state, nobody renders them

  const running = runs.filter(isActive).length;
  // while anything is unfinished, and while the server cannot be reached: with nothing running there is no other way to find out it is back
  const polling = running > 0 || offline;
  const inFlight = useRef(false);

  // whether the server answered
  const refresh = useCallback(async () => {
    if (inFlight.current) return true; // a slow answer must not pile requests up; it is not a failure either
    inFlight.current = true;
    try {
      const jobs = await fetchJobs();
      setRuns((all) => merge(jobs, all));
      setOffline(false);
      if (wasOffline.current) {
        wasOffline.current = false;
        toast({ tone: "info", title: "The server is reachable again", description: "The list is up to date." });
      }
      return true;
    } catch {
      wasOffline.current = true;
      setOffline(true); // keep what we show and try again
      return false;
    } finally {
      inFlight.current = false;
    }
  }, [toast]);

  // restore the runs of an earlier visit
  useEffect(() => {
    refresh().finally(() => setLoaded(true));
  }, [refresh]);

  useEffect(() => (polling ? startPolling(refresh) : undefined), [polling, refresh]);

  async function uploadOne(file: File): Promise<Run> {
    try {
      const body = new FormData();
      body.append("file", file);
      return toRun(await request("/jobs", { method: "POST", body }).then((response) => response.json()));
    } catch (error) {
      const message = error instanceof Error ? error.message : "the upload failed";
      const id = crypto.randomUUID();
      failedFiles.current.set(id, file);
      return {
        id,
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

  // each run appears as soon as its upload ends; one toast says how the batch went
  async function startUploads(files: File[]) {
    const results = await Promise.all(
      files.map((file) =>
        uploadOne(file).then((run) => {
          setRuns((all) => [...all, run]);
          return run;
        }),
      ),
    );
    const summary = uploadSummary(results.map((run) => ({ filename: run.filename, ok: !run.local, message: run.message })));
    if (summary) toast(summary);
  }

  function upload(files: File[]) {
    const pdfs = files.filter(isPdf);
    const skipped = skippedToast(files.length - pdfs.length);
    if (skipped) toast(skipped);
    if (pdfs.length === 0) return;
    preloadReport(); // while the agent runs
    void startUploads(pdfs);
  }

  function dismissRun(id: string) {
    failedFiles.current.delete(id);
    setRuns((all) => all.filter((run) => run.id !== id || !run.local));
  }

  function retryUpload(id: string) {
    const file = failedFiles.current.get(id);
    if (!file) return;
    dismissRun(id);
    void startUploads([file]);
  }

  async function decide(id: string, decision: Decision, by: string, reason: string) {
    const init = { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision, by, reason }) };
    const job = (await request(`/jobs/${id}/decision`, init).then((response) => response.json())) as Job;
    setRuns((all) => all.map((run) => (run.id === id ? toRun(job, run) : run)));
  }

  return (
    <ReportContext value={{ runs, running, loaded, offline, retry: async () => void (await refresh()), upload, retryUpload, dismissRun, decide }}>
      {children}
    </ReportContext>
  );
}

export function useReport() {
  const context = useContext(ReportContext);
  if (!context) throw new Error("useReport must be used inside <ReportProvider>");
  return context;
}
