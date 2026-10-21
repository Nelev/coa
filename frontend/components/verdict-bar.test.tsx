import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { VerdictBar, verdictSentence } from "@/components/verdict-bar";

describe("verdictSentence", () => {
  it("sums the verdicts up in words", () => {
    expect(verdictSentence({ pass: 9, review: 1, fail: 1 })).toBe("9 of 11 tests pass, 1 to review, 1 fail");
    expect(verdictSentence({ pass: 3, review: 0, fail: 0 })).toBe("3 of 3 tests pass");
    expect(verdictSentence({ pass: 1, review: 0, fail: 0 })).toBe("1 of 1 test passes");
    expect(verdictSentence({ pass: 0, review: 0, fail: 0 })).toBe("No test could be checked.");
  });
});

describe("VerdictBar", () => {
  it("counts each verdict, hidden from a screen reader since the sentence says the same", () => {
    const html = renderToStaticMarkup(<VerdictBar counts={{ pass: 9, review: 0, fail: 2 }} />);
    expect(html).toContain("aria-hidden");
    expect(html).toContain(">9</span> pass");
    expect(html).toContain(">2</span> fail");
    expect(html).not.toContain("flex-grow");
  });

  it("shows nothing when there is nothing to count", () => {
    expect(renderToStaticMarkup(<VerdictBar counts={{ pass: 0, review: 0, fail: 0 }} />)).toBe("");
  });
});
