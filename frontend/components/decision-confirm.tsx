"use client";

import { useRef, useState } from "react";
import { Problem } from "@/components/problem";
import type { Decision, Run } from "@/components/report-context";
import { runTitle } from "@/components/run-summary";
import { AlertDialog, AlertDialogClose, AlertDialogContent, AlertDialogDescription, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { resultSentence } from "@/components/verdict-bar";
import { confirmCopy } from "@/lib/decisions";

// Asks before a decision that cannot be taken back (or overrides the agent), and says back what is about to be recorded: which lot, what
// the agent found, who decides, and the reason. "Cancel" has the focus, so pressing Enter by reflex does not record anything.
export function DecisionConfirm({
  run,
  decision,
  by,
  reason,
  pending,
  error,
  onConfirm,
  onCancel,
}: {
  run: Run;
  decision: Decision | null;
  by: string;
  reason: string;
  pending: boolean;
  error?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const cancel = useRef<HTMLButtonElement>(null);
  // while it closes, the text must not change under the animation
  const [shown, setShown] = useState<Decision>("rejected");
  if (decision && decision !== shown) setShown(decision);
  const copy = confirmCopy(shown, run);
  const finding = run.result ? `${run.result.outcome}: ${resultSentence(run.result)}` : "No result";

  return (
    <AlertDialog open={decision !== null} onOpenChange={(open) => !open && !pending && onCancel()}>
      <AlertDialogContent initialFocus={cancel}>
        <div className="flex flex-col gap-1.5">
          <AlertDialogTitle>{copy.title}</AlertDialogTitle>
          <AlertDialogDescription>{copy.description}</AlertDialogDescription>
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 rounded-xl bg-muted/60 p-4 text-sm">
          <dt className="text-muted-foreground">Lot</dt>
          <dd className="font-medium break-words">{runTitle(run)}</dd>
          <dt className="text-muted-foreground">Agent found</dt>
          <dd>{finding}</dd>
          <dt className="text-muted-foreground">Deciding as</dt>
          <dd>{by}</dd>
          <dt className="text-muted-foreground">Reason</dt>
          <dd className="break-words whitespace-pre-wrap">{reason.trim() || "None given"}</dd>
        </dl>
        {error ? <Problem compact>{error}. Nothing was recorded; you can try again.</Problem> : null}
        <div className="flex flex-wrap justify-end gap-2">
          <AlertDialogClose render={<Button ref={cancel} variant="outline" size="lg" disabled={pending} />}>Cancel</AlertDialogClose>
          <Button size="lg" variant={shown === "rejected" ? "destructive" : "default"} disabled={pending} onClick={onConfirm}>
            {pending ? "Recording…" : copy.confirm}
          </Button>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
