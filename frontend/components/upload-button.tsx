"use client";

import { Upload } from "lucide-react";
import { useRef } from "react";

import { useReport } from "@/components/report-context";
import { Button } from "@/components/ui/button";

export function UploadButton() {
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
      <Button className="w-full" onClick={() => input.current?.click()}>
        <Upload />
        Upload documents
      </Button>
    </>
  );
}
