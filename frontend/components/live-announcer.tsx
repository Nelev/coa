"use client";

import { useEffect, useRef, useState } from "react";

import { type Run, useReport } from "@/components/report-context";

const TITLE = "COA Agent";

function sentence(run: Run): string {
  return run.state === "error" ? `${run.filename} failed: ${run.message}` : `${run.filename} finished: ${run.result?.outcome ?? "done"}`;
}

// Screen readers hear a run end without watching the list, and the tab title counts the runs still going.
export function LiveAnnouncer() {
  const { runs, running } = useReport();
  const [message, setMessage] = useState("");
  const previous = useRef(new Map<string, Run["state"]>());

  useEffect(() => {
    const ended = runs.filter((run) => {
      const before = previous.current.get(run.id);
      return (before === "queued" || before === "loading") && (run.state === "done" || run.state === "error");
    });
    previous.current = new Map(runs.map((run) => [run.id, run.state]));
    if (ended.length > 0) setMessage(ended.map(sentence).join(". "));
  }, [runs]);

  useEffect(() => {
    document.title = running > 0 ? `(${running}) ${TITLE}` : TITLE;
  }, [running]);

  return (
    <div role="status" aria-live="polite" className="sr-only">
      {message}
    </div>
  );
}
