"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

type Report =
  | { status: "idle" }
  | { status: "loading"; filename: string }
  | { status: "error"; message: string }
  | { status: "done"; spec: unknown };

const ReportContext = createContext<{ report: Report; upload: (file: File) => Promise<void> } | null>(null);

// Holds the report shared by the sidebar's upload button and the page content.
export function ReportProvider({ children }: { children: ReactNode }) {
  const [report, setReport] = useState<Report>({ status: "idle" });

  async function upload(file: File) {
    setReport({ status: "loading", filename: file.name });
    void import("@/components/report-renderer"); // preload the renderer chunk while the agent runs
    try {
      const body = new FormData();
      body.append("file", file);
      const response = await fetch(`${API_URL}/analyze`, { method: "POST", body });
      if (!response.ok) throw new Error(`the server answered ${response.status}`);
      setReport({ status: "done", spec: await response.json() });
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
