"use client";

import { defineCatalog, type Spec } from "@json-render/core";
import { defineRegistry, JSONUIProvider, Renderer } from "@json-render/react";
import { schema } from "@json-render/react/schema";
import { shadcnComponents } from "@json-render/shadcn";
import { shadcnComponentDefinitions } from "@json-render/shadcn/catalog";
import { useMemo } from "react";

// The components the report agent may use; keep in sync with RENDER_UI_PROMPT (backend/agent/prompts.py).
const NAMES = ["Stack", "Grid", "Card", "Separator", "Heading", "Text", "Badge", "Alert", "Table"] as const;

function pick<T extends Record<string, unknown>>(all: T): Pick<T, (typeof NAMES)[number]> {
  return Object.fromEntries(NAMES.map((name) => [name, all[name]])) as Pick<T, (typeof NAMES)[number]>;
}

const catalog = defineCatalog(schema, { components: pick(shadcnComponentDefinitions), actions: {} });
const { registry } = defineRegistry(catalog, { components: pick(shadcnComponents) });

export function ReportRenderer({ spec }: { spec: unknown }) {
  // The spec is written by a model: check it against the catalog before rendering it.
  const valid = useMemo(() => catalog.validate(spec).success, [spec]);
  if (!valid) {
    return (
      <p role="alert" className="text-sm text-destructive">
        The report could not be displayed: its layout is invalid.
      </p>
    );
  }
  return (
    <JSONUIProvider registry={registry}>
      <Renderer spec={spec as Spec} registry={registry} />
    </JSONUIProvider>
  );
}
