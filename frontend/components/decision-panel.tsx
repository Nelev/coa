"use client";

import dynamic from "next/dynamic";
import { useId, useRef, useState } from "react";

import { useAccount } from "@/components/account-context";
import { ActingAs } from "@/components/acting-as";
import { FIELD } from "@/components/field";
import { Problem } from "@/components/problem";
import { type Decision, type Run, useReport } from "@/components/report-context";
import { runTitle } from "@/components/run-summary";
import { DecisionChip } from "@/components/status-chip";
import { useToast } from "@/components/toaster";
import { Button } from "@/components/ui/button";
import { decisionToast, missingReason } from "@/lib/decisions";
import { formatMoment } from "@/lib/format";
import { isDecided, requiresReason } from "@/lib/runs";
import { useOnceOpened } from "@/lib/use-once-opened";

const BUTTONS: { decision: Decision; label: string; variant: "default" | "outline" | "destructive" }[] = [
  { decision: "approved", label: "Approve", variant: "default" },
  { decision: "on_hold", label: "Put on hold", variant: "outline" },
  { decision: "rejected", label: "Reject", variant: "destructive" },
];

// who decided what, and why
function Summary({ run }: { run: Run }) {
  return (
    <div className="flex flex-col gap-1.5 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <DecisionChip run={run} />
        <span className="text-muted-foreground">
          by {run.decidedBy}
          {run.decidedAt ? `, ${formatMoment(run.decidedAt)}` : ""}
        </span>
      </div>
      {run.reason ? <p className="text-foreground">{run.reason}</p> : null}
    </div>
  );
}

// the confirmation (an alert dialog) is loaded the first time a decision needs one
const DecisionConfirm = dynamic(() => import("@/components/decision-confirm").then((m) => m.DecisionConfirm));

function DecisionForm({ run, onDone }: { run: Run; onDone?: () => void }) {
  const { decide } = useReport();
  const { toast } = useToast();
  const { name } = useAccount();
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [asking, setAsking] = useState<Decision | null>(null); // the decision waiting for its confirmation
  const [missing, setMissing] = useState<Decision | null>(null); // the decision that was pressed without a reason
  const asked = useOnceOpened(asking !== null);
  const reasonField = useRef<HTMLTextAreaElement>(null);
  const ids = { reason: useId(), hint: useId(), missing: useId() };

  const overrides = requiresReason("approved", run); // approving needs a reason only when it overrides the agent

  async function submit(decision: Decision) {
    setPending(true);
    setError(undefined);
    try {
      await decide(run.id, decision, reason.trim());
      toast(decisionToast(decision, runTitle(run), name));
      setAsking(null);
      setReason("");
      onDone?.();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "the decision could not be saved");
    } finally {
      setPending(false);
    }
  }

  // Nothing is greyed out: a button that does nothing explains nothing. Pressing one without the reason it needs says so, next to the field.
  function choose(decision: Decision) {
    setError(undefined);
    // a decision that cannot be taken back, or overrides the agent (rejecting, holding, approving a lot that does not conform), needs a
    // reason and is confirmed first; approving a conforming lot is one click
    const consequential = requiresReason(decision, run);
    if (consequential && !reason.trim()) {
      setMissing(decision);
      reasonField.current?.focus();
      return;
    }
    setMissing(null);
    if (consequential) setAsking(decision);
    else void submit(decision);
  }

  return (
    <>
      {run.decision === "on_hold" && <Summary run={run} />}
      <ActingAs label="Deciding as" />
      <div className="flex flex-col gap-1.5">
        <label htmlFor={ids.reason} className="text-xs font-medium text-muted-foreground">
          Reason
        </label>
        <textarea
          ref={reasonField}
          id={ids.reason}
          value={reason}
          onChange={(event) => {
            setReason(event.target.value);
            setMissing(null);
          }}
          rows={3}
          aria-invalid={missing ? true : undefined}
          aria-describedby={missing ? `${ids.missing} ${ids.hint}` : ids.hint}
          placeholder="Why this decision"
          className={FIELD}
        />
        {missing ? (
          <p id={ids.missing} role="alert" className="text-xs font-medium text-destructive">
            {missingReason(missing)}
          </p>
        ) : null}
        <p id={ids.hint} className="text-xs text-subtle-foreground">
          {overrides
            ? "The agent did not find this lot conforming: every decision, including approving it, needs a reason."
            : "A reason is required to reject or hold a lot."}
        </p>
      </div>
      {error && !asking ? <Problem compact>{error}. Nothing was recorded; you can try again.</Problem> : null}
      <div className="flex flex-wrap gap-2">
        {BUTTONS.map(({ decision, label, variant }) => (
          <Button key={decision} variant={variant} disabled={pending} onClick={() => choose(decision)}>
            {decision === "approved" && overrides ? "Approve anyway" : label}
          </Button>
        ))}
      </div>
      {asked ? (
        <DecisionConfirm
          run={run}
          decision={asking}
          by={name}
          reason={reason}
          pending={pending}
          error={error}
          onConfirm={() => asking && submit(asking)}
          onCancel={() => {
            setAsking(null);
            setError(undefined);
          }}
        />
      ) : null}
    </>
  );
}

// The release decision always stays with a person: the agent only prepares the report. `bare`: inside a sheet that has its own title.
export function DecisionPanel({ run, bare = false, onDone }: { run: Run; bare?: boolean; onDone?: () => void }) {
  const body = isDecided(run) ? <Summary run={run} /> : <DecisionForm run={run} onDone={onDone} />;
  if (bare) return <div className="flex flex-col gap-4">{body}</div>;
  return (
    <section aria-label="Decision" className="flex flex-col gap-4 rounded-xl bg-card p-5 ring-1 ring-foreground/10">
      <h2 className="text-sm font-semibold">Decision</h2>
      {body}
    </section>
  );
}
