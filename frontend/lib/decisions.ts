import type { Decision, Run } from "@/components/report-context";

export type Copy = { title: string; description: string; confirm: string };

export function confirmCopy(decision: Decision, run: Run): Copy {
  switch (decision) {
    case "rejected":
      return { title: "Reject this lot?", description: "This is final: once it is recorded, it cannot be changed.", confirm: "Reject the lot" };
    case "on_hold":
      return {
        title: "Put this lot on hold?",
        description: "The lot stays open. You or a colleague can decide again later.",
        confirm: "Put on hold",
      };
    case "approved":
      return {
        title: run.result?.outcome === "Conforming" ? "Approve this lot?" : "Approve a lot the agent did not find conforming?",
        description: "This is final: once it is recorded, it cannot be changed.",
        confirm: "Approve anyway",
      };
  }
}

const DONE: Record<Decision, string> = { approved: "Lot approved", rejected: "Lot rejected", on_hold: "Lot put on hold" };

// the toast that says a decision was recorded: what, which lot, and who it is recorded as
export function decisionToast(decision: Decision, lot: string, by: string) {
  return { tone: "success" as const, title: DONE[decision], description: `${lot} · recorded as ${by}` };
}

const MISSING: Record<Decision, string> = {
  approved: "Add a reason to approve this lot.",
  rejected: "Add a reason to reject this lot.",
  on_hold: "Add a reason to put this lot on hold.",
};

// what is said beside the reason field when a decision is pressed without the reason it needs
export const missingReason = (decision: Decision) => MISSING[decision];
