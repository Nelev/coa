"use client";

import dynamic from "next/dynamic";
import { useState } from "react";

import type { Run } from "@/components/report-context";
import { DecisionChip } from "@/components/status-chip";
import { Button } from "@/components/ui/button";
import { isDecided } from "@/lib/runs";
import { useOnceOpened } from "@/lib/use-once-opened";

// On a phone or a tablet the decision does not fit beside the report: a bar stays at the foot of the screen, and its button opens the
// form as a sheet. (From the lg breakpoint the form sits in a column next to the report instead; see RunPage.)
const DecisionSheet = dynamic(() => import("@/components/decision-sheet").then((m) => m.DecisionSheet));

export function DecisionBar({ run }: { run: Run }) {
  const [open, setOpen] = useState(false);
  const used = useOnceOpened(open);
  const decided = isDecided(run);
  return (
    <>
      <div
        data-decision-bar
        className="fixed inset-x-0 bottom-0 z-30 flex items-center gap-3 border-t bg-card/95 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur lg:hidden"
      >
        <div className="flex min-w-0 flex-1 flex-col text-sm">
          {run.decision ? <DecisionChip run={run} /> : <span className="font-medium">Waiting for your decision</span>}
          {run.decidedBy ? <span className="truncate text-xs text-muted-foreground">by {run.decidedBy}</span> : null}
        </div>
        <Button size="lg" variant={decided ? "outline" : "default"} onClick={() => setOpen(true)}>
          {decided ? "Details" : "Decide"}
        </Button>
      </div>
      {/* the sheet (a dialog, the form) is loaded the first time it is asked for */}
      {used ? <DecisionSheet run={run} open={open} onOpenChange={setOpen} /> : null}
    </>
  );
}
