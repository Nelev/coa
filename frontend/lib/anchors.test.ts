import { describe, expect, it } from "vitest";

import { demoteTopHeading, issueTitles, slug, uniqueAnchors } from "@/lib/anchors";

describe("slug", () => {
  it("makes words an address can hold", () => {
    expect(slug("Assay (anhydrous basis)")).toBe("assay-anhydrous-basis");
    expect(slug("Water (Karl Fischer)")).toBe("water-karl-fischer");
    expect(slug("Crème brûlée – 5 %")).toBe("creme-brulee-5");
    expect(slug("(((")).toBe("");
  });
});

describe("uniqueAnchors", () => {
  it("links only the texts that occur once, and never gives two the same id", () => {
    const anchors = uniqueAnchors(["Assay", "Water", "Water", "A b", "A-b", "***"], "test");
    expect(anchors.get("Assay")).toBe("test-assay");
    expect(anchors.has("Water")).toBe(false);
    expect(anchors.get("A b")).toBe("test-a-b");
    expect(anchors.has("A-b")).toBe(false); // the same slug as "A b"
    expect(anchors.has("***")).toBe(false); // nothing left to make an id from
  });
});

const spec = {
  root: "page",
  elements: {
    page: { type: "Stack", children: ["title", "verdict", "h-issues", "i1", "i2", "h-tests", "table"] },
    title: { type: "Heading", props: { text: "Certificate of Analysis", level: "h1" } },
    verdict: { type: "Alert", props: { title: "Non-conforming" } },
    "h-issues": { type: "Heading", props: { text: "Issues (2)", level: "h2" } },
    i1: { type: "Alert", props: { title: "Assay" } },
    i2: { type: "Alert", props: { title: "Water" } },
    "h-tests": { type: "Heading", props: { text: "Test results", level: "h2" } },
    table: { type: "Table", props: {} },
  },
};

describe("issueTitles", () => {
  it("takes the alerts after the Issues heading, not the verdict above it", () => {
    expect(issueTitles(spec)).toEqual(["Assay", "Water"]);
  });

  it("finds nothing when the report is laid out differently", () => {
    expect(
      issueTitles({ root: "page", elements: { page: { type: "Stack", children: ["a"] }, a: { type: "Alert", props: { title: "x" } } } }),
    ).toEqual([]);
    expect(issueTitles({})).toEqual([]);
  });
});

describe("demoteTopHeading", () => {
  it("turns the report's h1 into an h2 and leaves the rest alone", () => {
    const out = demoteTopHeading(spec);
    expect(out.elements?.title.props?.level).toBe("h2");
    expect(out.elements?.["h-issues"].props?.level).toBe("h2");
    expect(spec.elements.title.props.level).toBe("h1"); // the input is not changed
  });

  it("returns the same spec when there is no h1", () => {
    const flat = { root: "a", elements: { a: { type: "Text", props: {} } } };
    expect(demoteTopHeading(flat)).toBe(flat);
  });
});
