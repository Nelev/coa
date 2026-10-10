"use client";

import { defineCatalog, type Spec } from "@json-render/core";
import { defineRegistry, JSONUIProvider, Renderer } from "@json-render/react";
import { schema } from "@json-render/react/schema";
import { shadcnComponentDefinitions } from "@json-render/shadcn/catalog";
import { useEffect, useMemo } from "react";

import {
  IssueAnchors,
  ReportAccordion,
  ReportAlert,
  ReportBadge,
  ReportCard,
  ReportCollapsible,
  ReportGrid,
  ReportHeading,
  ReportProgress,
  ReportSeparator,
  ReportStack,
  ReportTable,
  ReportText,
} from "@/components/report-parts";
import { demoteTopHeading, issueTitles, uniqueAnchors } from "@/lib/anchors";

// The components the report agent may use; keep in sync with RENDER_UI_PROMPT (backend/agent/prompts.py).
const NAMES = ["Stack", "Grid", "Card", "Separator", "Collapsible", "Accordion", "Heading", "Text", "Badge", "Alert", "Progress", "Table"] as const;

function pick<T extends Record<string, unknown>>(all: T): Pick<T, (typeof NAMES)[number]> {
  return Object.fromEntries(NAMES.map((name) => [name, all[name]])) as Pick<T, (typeof NAMES)[number]>;
}

const catalog = defineCatalog(schema, { components: pick(shadcnComponentDefinitions), actions: {} });
// Every component is drawn by us (components/report-parts.tsx): findings that can be linked to, the app's colors, one h1 per page, and none
// of the ~40 components of @json-render/shadcn, which cannot be imported one by one. Only the catalog (what a report may contain, and the
// check of it) comes from json-render.
const { registry } = defineRegistry(catalog, {
  components: {
    Stack: ReportStack,
    Grid: ReportGrid,
    Card: ReportCard,
    Separator: ReportSeparator,
    Collapsible: ReportCollapsible,
    Accordion: ReportAccordion,
    Heading: ReportHeading,
    Text: ReportText,
    Badge: ReportBadge,
    Alert: ReportAlert,
    Progress: ReportProgress,
    Table: ReportTable,
  },
});

export function ReportRenderer({ spec }: { spec: unknown }) {
  // The spec is written by a model: check it against the catalog before rendering it.
  const shown = useMemo(() => (catalog.validate(spec).success ? (demoteTopHeading(spec as Spec) as Spec) : null), [spec]);
  const issues = useMemo(() => uniqueAnchors(shown ? issueTitles(shown) : [], "issue"), [shown]);

  // the report arrives after the page, so the browser has already looked for #test-assay and not found it
  useEffect(() => {
    if (!shown) return;
    const id = decodeURIComponent(location.hash.slice(1));
    if (id) document.getElementById(id)?.scrollIntoView({ block: "center" });
  }, [shown]);

  if (!shown) {
    return (
      <p role="alert" className="text-sm text-destructive">
        The report could not be displayed: its layout is invalid.
      </p>
    );
  }
  return (
    <div className="report max-w-4xl">
      <IssueAnchors value={issues}>
        <JSONUIProvider registry={registry}>
          <Renderer spec={shown} registry={registry} />
        </JSONUIProvider>
      </IssueAnchors>
    </div>
  );
}
