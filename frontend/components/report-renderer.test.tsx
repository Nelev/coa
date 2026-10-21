import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ReportRenderer } from "@/components/report-renderer";

const SPEC = { root: "a", elements: { a: { type: "Text", props: { text: "Assay: 99.8 %" }, children: [] } } };

describe("ReportRenderer", () => {
  it("renders a spec that matches the catalog", () => {
    expect(renderToStaticMarkup(<ReportRenderer spec={SPEC} />)).toContain("Assay: 99.8 %");
  });

  it("shows an error instead of rendering a spec that is not valid", () => {
    const html = renderToStaticMarkup(<ReportRenderer spec={{ elements: "not a map" }} />);
    expect(html).toContain("layout is invalid");
  });

  it("logs why a spec is not valid", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const spec = { root: "a", elements: { a: { type: "Video", props: {}, children: [] } } };
    renderToStaticMarkup(<ReportRenderer spec={spec} />);
    expect(log).toHaveBeenCalledWith("the report's layout is invalid:", expect.anything());
    log.mockRestore();
  });

  it("rejects a component that is outside the catalog", () => {
    const spec = { root: "a", elements: { a: { type: "Video", props: {}, children: [] } } };
    expect(renderToStaticMarkup(<ReportRenderer spec={spec} />)).toContain("layout is invalid");
  });
});

// every component the report agent may use, laid out the way RENDER_UI_PROMPT asks for
const FULL = {
  root: "page",
  elements: {
    page: {
      type: "Stack",
      props: { direction: "vertical", gap: "lg", align: "stretch" },
      children: ["bar", "line", "details", "h-issues", "i1", "more", "steps", "h-tests", "tests", "done"],
    },
    bar: { type: "Stack", props: { direction: "horizontal", justify: "between", align: "center" }, children: ["h1", "badge"] },
    h1: { type: "Heading", props: { text: "Certificate of Analysis CoA-1", level: "h1" }, children: [] },
    badge: { type: "Badge", props: { text: "Non-conforming", variant: "destructive" }, children: [] },
    line: { type: "Separator", props: { orientation: "horizontal" }, children: [] },
    details: { type: "Grid", props: { columns: 2, gap: "md" }, children: ["card"] },
    card: { type: "Card", props: { title: "Material", description: "What was shipped" }, children: ["note"] },
    note: { type: "Text", props: { text: "Citric acid", variant: "muted" }, children: [] },
    "h-issues": { type: "Heading", props: { text: "Issues (1)", level: "h2" }, children: [] },
    i1: { type: "Alert", props: { title: "Assay", message: "Below the minimum.", type: "error" }, children: [] },
    more: { type: "Collapsible", props: { title: "More detail", defaultOpen: true }, children: ["code"] },
    code: { type: "Text", props: { text: "L26-09-3402", variant: "code" }, children: [] },
    steps: {
      type: "Accordion",
      props: {
        type: "single",
        items: [
          { title: "Method", content: "Ph. Eur. 2.2.29" },
          { title: "Limit", content: "99.5 %" },
        ],
      },
      children: [],
    },
    "h-tests": { type: "Heading", props: { text: "Test results", level: "h2" }, children: [] },
    tests: {
      type: "Table",
      props: {
        columns: ["Test", "Verdict"],
        rows: [
          ["Assay", "Fail"],
          ["Water", "Pass"],
        ],
      },
      children: [],
    },
    done: { type: "Progress", props: { value: 8, max: 11, label: "Tests passed" }, children: [] },
  },
};

describe("ReportRenderer with every component", () => {
  const html = renderToStaticMarkup(<ReportRenderer spec={FULL} />);

  it("draws all of them, from the spec the prompt describes", () => {
    for (const text of [
      "Non-conforming",
      "Material",
      "What was shipped",
      "Citric acid",
      "Below the minimum.",
      "More detail",
      "L26-09-3402",
      "Method",
      "Ph. Eur. 2.2.29",
      "Tests passed",
    ]) {
      expect(html).toContain(text);
    }
    expect(html).toContain("grid-cols-2"); // the stylesheet that stacks the grid on a phone looks for this class
    expect(html).toContain("<hr");
  });

  it("makes the report's h1 an h2, so the page keeps its one h1", () => {
    expect(html).not.toContain("<h1");
    expect(html).toContain("<h2");
  });

  it("opens a collapsible when the spec says so, and draws the accordion as disclosures that close one another", () => {
    expect(html).toMatch(/<details[^>]* open=""/);
    const names = [...html.matchAll(/<details[^>]*name="([^"]+)"/g)].map((m) => m[1]);
    expect(names).toHaveLength(2);
    expect(new Set(names).size).toBe(1); // one group: opening one closes the other
  });

  it("states the progress as a number, not only a bar", () => {
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-valuenow="8"');
    expect(html).toContain('aria-valuemax="11"');
  });

  it("gives the issue and the test row a link, and the verdict an icon and a word", () => {
    expect(html).toContain('id="issue-assay"');
    expect(html).toContain('id="test-assay"');
    expect(html).toContain("Copy link to Assay");
    expect(html).not.toContain('role="alert"'); // a finding is content, not a message
  });
});
