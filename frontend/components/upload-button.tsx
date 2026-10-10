"use client";

import { Upload } from "lucide-react";
import { useRef } from "react";

import { useReport } from "@/components/report-context";
import { Button } from "@/components/ui/button";

// compact: on a phone only the icon shows (the label stays for screen readers)
export function UploadButton({ compact = false }: { compact?: boolean }) {
  const { upload } = useReport();
  const input = useRef<HTMLInputElement>(null);

  return (
    <>
      <input
        ref={input}
        type="file"
        accept="application/pdf"
        multiple
        hidden
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = ""; // lets the same files be picked again
          upload(files);
        }}
      />
      <Button className={compact ? "w-full max-sm:size-8 max-sm:pointer-coarse:size-10 max-sm:p-0" : "w-full"} onClick={() => input.current?.click()}>
        <Upload />
        <span className={compact ? "max-sm:sr-only" : undefined}>Upload documents</span>
      </Button>
    </>
  );
}
