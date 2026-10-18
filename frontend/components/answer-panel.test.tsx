import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AnswerPanel } from "@/components/answer-panel";
import type { Run } from "@/components/report-context";

vi.mock("@/components/report-context", () => ({ useReport: () => ({ answer: vi.fn() }) }));
vi.mock("@/components/toaster", () => ({ useToast: () => ({ toast: vi.fn(), dismiss: vi.fn() }) }));

const ask = {
  test: "Lead (Pb)",
  reason: "The CoA reports Lead in ppb; it could be a typo for ppm.",
  supplier_result: "0.2 ppb",
  plant_requirement: "max 0.3 ppm",
};
const base: Run = {
  id: "abc",
  filename: "coa.pdf",
  state: "waiting",
  startedAt: 1,
  finishedAt: 0,
  statuses: [],
  question: { id: "q1", questions: [ask, { ...ask, test: "Arsenic (As)", supplier_result: null }] },
};
const panel = (run: Partial<Run> = {}) => renderToStaticMarkup(<AnswerPanel run={{ ...base, ...run }} />);

describe("AnswerPanel", () => {
  it("shows each flagged check with its reason and the figures it is about", () => {
    const html = panel();
    expect(html).toContain("Lead (Pb)");
    expect(html).toContain("could be a typo for ppm");
    expect(html).toContain("CoA: 0.2 ppb · Plant requires: max 0.3 ppm");
    expect(html.match(/<textarea/g)).toHaveLength(2);
    expect(html).toContain("these tests");
  });

  it("leaves out the figures that are not known", () => {
    const html = panel({ question: { id: "q2", questions: [{ ...ask, supplier_result: null, plant_requirement: null }] } });
    expect(html).not.toContain("CoA: ");
    expect(html).toContain("this test");
  });

  it("offers to answer or to keep the agent's verdicts, neither greyed out, and says who answers", () => {
    const html = panel();
    expect(html).toContain("Send answer");
    expect(html).toContain("Keep the agent&#x27;s verdicts"); // the markup escapes the apostrophe
    expect(html).toContain("Answering as");
    expect(html).not.toContain('disabled=""');
  });
});
