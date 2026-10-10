import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DecisionPanel } from "@/components/decision-panel";
import type { Run } from "@/components/report-context";

vi.mock("@/components/report-context", () => ({ useReport: () => ({ decide: vi.fn() }) }));
vi.mock("@/components/toaster", () => ({ useToast: () => ({ toast: vi.fn(), dismiss: vi.fn() }) }));

const result = { outcome: "Conforming" as const, counts: { pass: 3, fail: 0, review: 0 }, product: null, lot: null, supplier: null };
const base: Run = { id: "abc", filename: "coa.pdf", state: "done", startedAt: 1, finishedAt: 2, statuses: [], result };
const panel = (run: Partial<Run>) => renderToStaticMarkup(<DecisionPanel run={{ ...base, ...run }} />);

describe("DecisionPanel", () => {
  it("offers the three decisions, none of them greyed out: a missing reason is said when one is pressed, not by a dead button", () => {
    const html = panel({});
    expect(html).toContain("Approve");
    expect(html).toContain("Put on hold");
    expect(html).toContain("Reject");
    expect(html).not.toContain('disabled=""');
    expect(html).toContain("A reason is required to reject or hold a lot.");
  });

  it("calls approving a lot that does not conform an override and asks for a reason", () => {
    const html = panel({ result: { ...result, outcome: "Non-conforming" } });
    expect(html).toContain("Approve anyway");
    expect(html).not.toContain('disabled=""');
    expect(html).toContain("including approving it");
  });

  it("shows only who decided, when and why, once the decision is final", () => {
    const html = panel({ decision: "rejected", decidedBy: "QA Anna Rossi", decidedAt: 1_700_000_000_000, reason: "Wrong lot" });
    expect(html).toContain("Rejected");
    expect(html).toContain("QA Anna Rossi");
    expect(html).toContain("Wrong lot");
    expect(html).not.toContain("<textarea");
  });

  it("keeps the form, with the hold shown, while a lot is on hold", () => {
    const html = panel({ decision: "on_hold", decidedBy: "QC Marco Bianchi", reason: "Waiting for the supplier" });
    expect(html).toContain("Waiting for the supplier");
    expect(html).toContain("<textarea");
  });
});
