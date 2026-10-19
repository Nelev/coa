import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AnswerPanel, Precedents, RememberChoice } from "@/components/answer-panel";
import type { Precedent, Run } from "@/components/report-context";

vi.mock("@/components/report-context", () => ({ useReport: () => ({ answer: vi.fn() }) }));
vi.mock("@/components/account-context", () => ({ useAccount: () => ({ name: "Anna Rossi", email: "anna@example.com" }) }));
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
    expect(html).toContain("Anna Rossi"); // the signed-in person: there is nobody to choose
    expect(html).not.toContain('disabled=""');
  });

  it("asks who an answer is kept for only once there is one to keep", () => {
    expect(panel()).not.toContain("Keep this answer for");
  });
});

describe("RememberChoice", () => {
  const choice = (value: "product" | "global" | "none") => renderToStaticMarkup(<RememberChoice value={value} onChange={vi.fn()} />);

  it("offers the three scopes in a labelled group, with the chosen one checked", () => {
    const html = choice("global");
    expect(html).toContain("<legend");
    expect(html).toContain("Keep this answer for");
    expect(html.match(/type="radio"/g)).toHaveLength(3);
    expect(html.match(/checked=""/g)).toHaveLength(1);
    for (const label of ["This product&#x27;s future lots", "All products", "This lot only"]) expect(html).toContain(label);
  });

  it("says what keeping an answer does, and that a lot-only answer saves nothing", () => {
    const html = choice("product");
    expect(html).toContain("aria-describedby");
    expect(html).toContain("saves nothing");
  });
});

describe("Precedents", () => {
  const earlier: Precedent = {
    id: "old:Lead",
    answer: "The supplier prints ppb for ppm.",
    summary: "ppb on this CoA is ppm.",
    by: "QA Marco",
    at: Date.UTC(2026, 9, 9, 12),
    run_id: "old",
    lot: "L7",
    match: "same_product",
  };
  const precedents = (list: Precedent[]) => renderToStaticMarkup(<Precedents precedents={list} onUse={vi.fn()} />);

  it("shows nothing when nothing was answered before", () => {
    expect(precedents([])).toBe("");
  });

  it("lists each earlier answer, who gave it, for which lot, and how close the case is, in a disclosure", () => {
    const html = precedents([
      earlier,
      { ...earlier, id: "other:Lead", run_id: "other", answer: "Another.", match: "similar", by: null, lot: null, summary: null },
    ]);
    expect(html).toContain("<details");
    expect(html).toContain("Answered before (2)");
    expect(html).toContain("The supplier prints ppb for ppm.");
    expect(html).toContain("Same product and test · QA Marco");
    expect(html).toContain("Lot L7");
    expect(html).toContain("Similar case");
    expect(html).toContain("ppb on this CoA is ppm.");
    expect(html.match(/Use this answer/g)).toHaveLength(2);
    expect(html).not.toContain("Lot null");
  });

  it("is on the panel only for a check that has earlier answers", () => {
    const withPrecedents = { question: { id: "q3", questions: [{ ...ask, precedents: [earlier] }, ask] } };
    const html = panel(withPrecedents);
    expect(html.match(/Answered before/g)).toHaveLength(1);
    expect(html.indexOf("Answered before")).toBeLessThan(html.indexOf("<textarea")); // read before answering
    expect(panel()).not.toContain("Answered before");
  });
});
