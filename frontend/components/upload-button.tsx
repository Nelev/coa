"use client";

import { Loader2, Upload } from "lucide-react";
import { useRef } from "react";

import { useReport } from "@/components/report-context";
import { Button } from "@/components/ui/button";

export function UploadButton() {
  const { report, upload } = useReport();
  const input = useRef<HTMLInputElement>(null);
  const loading = report.status === "loading";

  return (
    <>
      <input
        ref={input}
        type="file"
        accept="application/pdf"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = ""; // lets the same file be picked again
          if (file) void upload(file);
        }}
      />
      <Button className="w-full" disabled={loading} onClick={() => input.current?.click()}>
        {loading ? <Loader2 className="animate-spin" /> : <Upload />}
        {loading ? "Analyzing…" : "Upload document"}
      </Button>
    </>
  );
}
