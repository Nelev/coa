"use client";

import { createContext, type ReactNode, useContext, useRef, useState } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

// browsers allow about 6 connections per origin to an HTTP/1.1 server; each analysis holds one open, so stay well under
const MAX_PARALLEL = 3;

// statuses: what the agent reported while it worked, in order; the last one is what it is doing now.
// queued: waiting for a free slot; error: `message` says why, `statuses` how far the agent got.
export type Run = {
  id: number;
  filename: string;
  state: "queued" | "loading" | "done" | "error";
  startedAt: number;
  statuses: string[];
  spec?: unknown;
  message?: string;
};

const ReportContext = createContext<{
  runs: Run[];
  selectedId: number | null;
  select: (id: number) => void;
  upload: (files: File[]) => void;
} | null>(null);

// Holds the runs shared by the sidebar and the page content, and starts them at most MAX_PARALLEL at a time.
export function ReportProvider({ children }: { children: ReactNode }) {
  const [runs, setRuns] = useState<Run[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const waiting = useRef<{ id: number; file: File }[]>([]);
  const active = useRef(0);
  const nextId = useRef(0);

  function update(id: number, change: Partial<Run>) {
    setRuns((all) => all.map((run) => (run.id === id ? { ...run, ...change } : run)));
  }

  async function analyze(id: number, file: File) {
    update(id, { state: "loading", startedAt: Date.now() });
    try {
      const body = new FormData();
      body.append("file", file);
      const response = await fetch(`${API_URL}/analyze`, { method: "POST", body });
      if (!response.ok || !response.body) throw new Error(`the server answered ${response.status}`);

      // the server sends one JSON line per event: {status} as the agent works, then {done: spec} or {error}
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += value;
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines.filter(Boolean)) {
            const event = JSON.parse(line);
            if ("status" in event) {
              setRuns((all) => all.map((run) => (run.id === id ? { ...run, statuses: [...run.statuses, event.status] } : run)));
            } else if ("error" in event) {
              throw new Error(event.error);
            } else if ("done" in event) {
              update(id, { state: "done", spec: event.done });
              return;
            }
          }
        }
      } finally {
        void reader.cancel(); // stops the download if we leave the loop early, e.g. on an error event
      }
      throw new Error("the connection closed before the report was ready");
    } catch (error) {
      update(id, { state: "error", message: error instanceof Error ? error.message : "the upload failed" });
    }
  }

  function pump() {
    while (active.current < MAX_PARALLEL) {
      const next = waiting.current.shift();
      if (!next) return;
      active.current++;
      void analyze(next.id, next.file).finally(() => {
        active.current--;
        pump();
      });
    }
  }

  function upload(files: File[]) {
    const added = files.map((file) => ({ id: nextId.current++, file }));
    if (added.length === 0) return;
    void import("@/components/report-renderer"); // preload the renderer chunk while the agent runs
    setRuns((all) => [...all, ...added.map(({ id, file }): Run => ({ id, filename: file.name, state: "queued", startedAt: 0, statuses: [] }))]);
    setSelectedId((current) => current ?? added[0].id); // don't pull the user away from a report they are reading
    waiting.current.push(...added);
    pump();
  }

  return <ReportContext value={{ runs, selectedId, select: setSelectedId, upload }}>{children}</ReportContext>;
}

export function useReport() {
  const context = useContext(ReportContext);
  if (!context) throw new Error("useReport must be used inside <ReportProvider>");
  return context;
}
