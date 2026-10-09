"use client";

import { Upload } from "lucide-react";
import { type ReactNode, useEffect, useEffectEvent, useRef, useState } from "react";

import { useReport } from "@/components/report-context";

const hasFiles = (event: DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes("Files");

// Dropping PDFs anywhere on the page uploads them; while files are dragged over it, an overlay says so.
export function PageDropzone({ children }: { children: ReactNode }) {
  const { upload } = useReport();
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0); // dragenter / dragleave also fire for every child element
  const uploadDropped = useEffectEvent((files: File[]) => upload(files)); // the listeners below are added once, not per render

  useEffect(() => {
    const enter = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      depth.current += 1;
      setDragging(true);
    };
    const leave = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setDragging(false);
    };
    const over = (event: DragEvent) => {
      if (hasFiles(event)) event.preventDefault(); // allows the drop
    };
    const drop = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      depth.current = 0;
      setDragging(false);
      uploadDropped(Array.from(event.dataTransfer?.files ?? []));
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
    };
  }, []);

  return (
    <>
      {children}
      {dragging && (
        <div aria-hidden className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-primary px-16 py-12 text-primary">
            <Upload className="size-8" />
            <p className="text-lg font-medium">Drop PDFs to analyze</p>
          </div>
        </div>
      )}
    </>
  );
}
