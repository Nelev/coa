"use client";

import Link from "next/link";

import { NavAuth } from "@/components/nav-auth";
import { useReport } from "@/components/report-context";
import { UploadButton } from "@/components/upload-button";

export function AppHeader() {
  const { running } = useReport();
  return (
    <header className="sticky top-0 z-20 border-b bg-background/85 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-4 px-4 md:px-6">
        <Link href="/" className="flex items-center gap-2 rounded-md font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <span className="flex size-7 items-center justify-center rounded-md bg-primary text-sm text-primary-foreground">C</span>
          COA Agent
        </Link>
        {running > 0 && (
          <span className="hidden text-xs text-muted-foreground sm:inline">
            {running} {running === 1 ? "analysis" : "analyses"} running
          </span>
        )}
        <div className="ml-auto flex items-center gap-3">
          <div className="w-40">
            <UploadButton />
          </div>
          <NavAuth />
        </div>
      </div>
    </header>
  );
}
