// What a link to a finding points at. The report is written by a model, so its elements have no stable ids of their own: an id is made from
// the words of the finding ("issue-assay-anhydrous-basis", "test-water-karl-fischer"), which stay the same for as long as the report does.

type Element = { type?: string; props?: Record<string, unknown>; children?: string[] };
type Spec = { root?: string; elements?: Record<string, Element> };

export function slug(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

// text -> id, for the texts that occur once. A text that repeats gets no link: an id must be unique on the page, and a link to "the first of two" would mislead.
export function uniqueAnchors(texts: string[], prefix: string): Map<string, string> {
  const seen = new Map<string, number>();
  for (const text of texts) seen.set(text, (seen.get(text) ?? 0) + 1);
  const anchors = new Map<string, string>();
  const used = new Set<string>();
  for (const text of texts) {
    const id = `${prefix}-${slug(text)}`;
    if (seen.get(text) !== 1 || !slug(text) || used.has(id)) continue; // different words can make the same slug
    used.add(id);
    anchors.set(text, id);
  }
  return anchors;
}

// The titles of the issues: the Alerts that follow the "Issues" heading of the root's children, up to the next element that is not an Alert.
// Nothing when the report has no such heading (then there is nothing to link to rather than a guess).
export function issueTitles(spec: Spec): string[] {
  const elements = spec.elements ?? {};
  const children = (spec.root ? elements[spec.root]?.children : undefined) ?? [];
  const start = children.findIndex((key) => elements[key]?.type === "Heading" && /^issues\b/i.test(String(elements[key]?.props?.text ?? "")));
  if (start < 0) return [];
  const titles: string[] = [];
  for (const key of children.slice(start + 1)) {
    const element = elements[key];
    if (element?.type !== "Alert") break;
    titles.push(String(element.props?.title ?? ""));
  }
  return titles;
}

// The report's own h1 is the page's h1 now (the run's title), so it steps down a level; nothing else about the spec changes.
export function demoteTopHeading(spec: Spec): Spec {
  const elements = spec.elements;
  if (!elements || !Object.values(elements).some((e) => e?.type === "Heading" && e.props?.level === "h1")) return spec;
  return {
    ...spec,
    elements: Object.fromEntries(
      Object.entries(elements).map(([key, e]) => [
        key,
        e?.type === "Heading" && e.props?.level === "h1" ? { ...e, props: { ...e.props, level: "h2" } } : e,
      ]),
    ),
  };
}
