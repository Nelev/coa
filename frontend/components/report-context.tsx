"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

type Report =
  | { status: "idle" }
  | { status: "loading"; filename: string; steps: string[] }
  | { status: "error"; message: string }
  | { status: "done"; spec: unknown };

const ReportContext = createContext<{ report: Report; upload: (file: File) => Promise<void> } | null>(null);

// Holds the report shared by the sidebar's upload button and the page content.
export function ReportProvider({ children }: { children: ReactNode }) {
  const [report, setReport] = useState<Report>({ status: "idle" });

  async function upload(file: File) {
    setReport({ status: "loading", filename: file.name, steps: [] });
    void import("@/components/report-renderer"); // preload the renderer chunk while the agent runs
    try {
      const body = new FormData();
      body.append("file", file);
      const response = await fetch(`${API_URL}/analyze`, { method: "POST", body });
      if (!response.ok || !response.body) throw new Error(`the server answered ${response.status}`);

      // the server sends one JSON line per event: {step}, then {done: spec} or {error}
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
            if ("step" in event) {
              setReport((r) => (r.status === "loading" ? { ...r, steps: [...r.steps, event.step] } : r));
            } else if ("error" in event) {
              throw new Error(event.error);
            } else if ("done" in event) {
              setReport({ status: "done", spec: event.done });
              return;
            }
          }
        }
      } finally {
        void reader.cancel(); // stops the download if we leave the loop early, e.g. on an error event
      }
      throw new Error("the connection closed before the report was ready");
    } catch (error) {
      setReport({
        status: "error",
        message: error instanceof Error ? error.message : "the upload failed",
      });
    }
  }

  return <ReportContext value={{ report, upload }}>{children}</ReportContext>;
}

export function useReport() {
  const context = useContext(ReportContext);
  if (!context) throw new Error("useReport must be used inside <ReportProvider>");
  return context;
}
