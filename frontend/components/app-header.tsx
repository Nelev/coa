"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { useReport } from "@/components/report-context";
import { UploadButton } from "@/components/upload-button";
import { type Account, UserMenu } from "@/components/user-menu";
import type { Theme } from "@/lib/theme";
import { cn } from "@/lib/utils";

export function AppHeader({ account, theme }: { account: Account; theme: Theme }) {
  const { running } = useReport();
  const pathname = usePathname();
  const onRuns = pathname === "/" || pathname.startsWith("/runs");
  return (
    <header className="sticky top-0 z-20 border-b bg-background/85 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-4 px-4 md:px-6">
        <Link href="/" className="flex items-center gap-2 rounded-md font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <span aria-hidden className="flex size-7 items-center justify-center rounded-md bg-primary text-sm text-primary-foreground">
            C
          </span>
          COA Agent
        </Link>
        <nav aria-label="Primary" className="hidden sm:block">
          <Link
            href="/"
            aria-current={onRuns ? "page" : undefined}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
              onRuns && "bg-muted text-foreground",
            )}
          >
            Runs
          </Link>
        </nav>
        {running > 0 && (
          <Link
            href="/?filter=progress"
            className="hidden rounded-md px-2 py-1 text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring md:inline"
          >
            {running} {running === 1 ? "analysis" : "analyses"} running
          </Link>
        )}
        <div className="ml-auto flex items-center gap-2">
          <div className="sm:w-40">
            <UploadButton compact />
          </div>
          <UserMenu account={account} theme={theme} />
        </div>
      </div>
    </header>
  );
}
