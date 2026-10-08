import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
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

  it("rejects a component that is outside the catalog", () => {
    const spec = { root: "a", elements: { a: { type: "Video", props: {}, children: [] } } };
    expect(renderToStaticMarkup(<ReportRenderer spec={spec} />)).toContain("layout is invalid");
  });
});
