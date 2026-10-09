"use client";

import { createContext, type ReactNode, useContext, useState } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

// statuses: what the agent reported while it worked, in order; the last one is what it is doing now.
type Run = { filename: string; startedAt: number; statuses: string[] };

type Report =
  | { status: "idle" }
  | ({ status: "loading" } & Run)
  | { status: "error"; message: string; run?: Run } // run: how far the agent got, if the stream had started
  | ({ status: "done"; spec: unknown } & Run); // the statuses are kept next to the report

const ReportContext = createContext<{ report: Report; upload: (file: File) => Promise<void> } | null>(null);

// Holds the report shared by the sidebar's upload button and the page content.
export function ReportProvider({ children }: { children: ReactNode }) {
  const [report, setReport] = useState<Report>({ status: "idle" });

  async function upload(file: File) {
    setReport({ status: "loading", filename: file.name, startedAt: Date.now(), statuses: [] });
    void import("@/components/report-renderer"); // preload the renderer chunk while the agent runs
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
              setReport((r) => (r.status === "loading" ? { ...r, statuses: [...r.statuses, event.status] } : r));
            } else if ("error" in event) {
              throw new Error(event.error);
            } else if ("done" in event) {
              setReport((r) => (r.status === "loading" ? { ...r, status: "done", spec: event.done } : r));
              return;
            }
          }
        }
      } finally {
        void reader.cancel(); // stops the download if we leave the loop early, e.g. on an error event
      }
      throw new Error("the connection closed before the report was ready");
    } catch (error) {
      const message = error instanceof Error ? error.message : "the upload failed";
      setReport((r) =>
        r.status === "loading"
          ? { status: "error", message, run: { filename: r.filename, startedAt: r.startedAt, statuses: r.statuses } }
          : { status: "error", message },
      );
    }
  }

  return <ReportContext value={{ report, upload }}>{children}</ReportContext>;
}

export function useReport() {
  const context = useContext(ReportContext);
  if (!context) throw new Error("useReport must be used inside <ReportProvider>");
  return context;
}
