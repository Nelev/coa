"use client";

import { X } from "lucide-react";

import { DecisionPanel } from "@/components/decision-panel";
import type { Run } from "@/components/report-context";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

// The decision form as a sheet rising from the foot of a phone's screen (see DecisionBar); closed again when the decision is saved.
export function DecisionSheet({ run, open, onOpenChange }: { run: Run; open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent variant="sheet">
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-1">
            <DialogTitle>Decision</DialogTitle>
            <DialogDescription className="truncate">{run.filename}</DialogDescription>
          </div>
          <DialogClose render={<Button variant="ghost" size="icon" aria-label="Close" />}>
            <X />
          </DialogClose>
        </div>
        <DecisionPanel run={run} bare onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}
