"use client";

import { Check, ChevronDown, CircleCheck, CircleX, Link2, TriangleAlert } from "lucide-react";
import { createContext, type ReactNode, useContext, useEffect, useId, useMemo, useRef, useState } from "react";

import { TONE } from "@/components/tones";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { uniqueAnchors } from "@/lib/anchors";
import { cn } from "@/lib/utils";

// title -> id of the issues that can be linked to (see lib/anchors.ts)
export const IssueAnchors = createContext<Map<string, string>>(new Map());

// Copies the address of a finding and puts it in the address bar too, so it can be shared from there as well. Shown on hover and on
// focus, and always on a touch screen, which has no hover.
export function AnchorLink({ id, label, className }: { id: string; label: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy() {
    const url = `${location.origin}${location.pathname}${location.search}#${id}`;
    history.replaceState(null, "", `#${id}`);
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2000);
    } catch {} // no clipboard: the address bar has the link now
  }

  return (
    <>
      <button
        type="button"
        onClick={copy}
        aria-label={`Copy link to ${label}`}
        className={cn(
          "inline-flex size-6 items-center justify-center rounded-md text-subtle-foreground opacity-0 transition-opacity outline-none group-focus-within/anchor:opacity-100 group-hover/anchor:opacity-100 hover:bg-muted hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:size-9 pointer-coarse:opacity-100",
          copied && "opacity-100",
          className,
        )}
      >
        {copied ? <Check aria-hidden className="size-3.5 text-success" /> : <Link2 aria-hidden className="size-3.5" />}
      </button>
      <span role="status" className="sr-only">
        {copied ? "Link copied" : ""}
      </span>
    </>
  );
}

// the kinds of finding a report may have (json-render's Alert types), as a tone of the app plus the words a screen reader hears
const TONES = {
  error: { ...TONE.error, label: "Error", box: "bg-destructive/10 ring-destructive/25" },
  warning: { ...TONE.warning, label: "Warning", box: "bg-warning/10 ring-warning/30" },
  success: { ...TONE.success, label: "Success", box: "bg-success/10 ring-success/25" },
  info: { ...TONE.info, label: "Note", box: "bg-info/10 ring-info/25" },
} as const;

// A finding of the report. It is content, not a message to the person, so it has no role="alert" (a report of ten findings would
// read all ten aloud when it loads); the kind is said in words for a screen reader and shown by an icon and a tint.
export function ReportAlert({ props }: { props: { title: string; message?: string | null; type?: string | null } }) {
  const tone = TONES[(props.type as keyof typeof TONES) ?? "info"] ?? TONES.info;
  const Icon = tone.icon;
  const id = useContext(IssueAnchors).get(props.title);
  return (
    <div id={id} className={cn("group/anchor relative flex scroll-mt-24 gap-3 rounded-xl p-4 ring-1 target:ring-2 target:ring-primary", tone.box)}>
      <Icon aria-hidden className={cn("mt-0.5 size-4 shrink-0", tone.tint)} />
      <div className={cn("flex min-w-0 flex-1 flex-col gap-0.5", id && "pr-7")}>
        <p className="text-sm font-medium">
          <span className="sr-only">{tone.label}: </span>
          {props.title}
        </p>
        {props.message ? <p className="text-sm text-muted-foreground">{props.message}</p> : null}
      </div>
      {id ? <AnchorLink id={id} label={props.title} className="absolute top-2.5 right-2.5" /> : null}
    </div>
  );
}

const HEADINGS = {
  h1: "text-xl font-semibold",
  h2: "text-lg font-semibold",
  h3: "text-base font-semibold",
  h4: "text-sm font-semibold",
} as const;

export function ReportHeading({ props }: { props: { text: string; level?: string | null } }) {
  const level = (props.level as keyof typeof HEADINGS) in HEADINGS ? (props.level as keyof typeof HEADINGS) : "h2";
  const Tag = level;
  return <Tag className={cn("text-left text-balance", HEADINGS[level])}>{props.text}</Tag>;
}

const VERDICTS: Record<string, { icon: typeof CircleX; tint: string }> = {
  Pass: { icon: CircleCheck, tint: "text-success" },
  Review: { icon: TriangleAlert, tint: "text-warning" },
  Fail: { icon: CircleX, tint: "text-destructive" },
};

// A table of the report. The one that lists the tests ("Test" is its first column) gets a link for each test, and its "Verdict" column
// an icon and a color beside the word.
export function ReportTable({ props }: { props: { columns: string[]; rows: unknown[][]; caption?: string | null } }) {
  const columns = props.columns ?? [];
  const rows = useMemo(() => (props.rows ?? []).map((row) => row.map(String)), [props.rows]);
  const linkable = columns[0] === "Test";
  const anchors = useMemo(
    () =>
      linkable
        ? uniqueAnchors(
            rows.map((row) => row[0]),
            "test",
          )
        : new Map<string, string>(),
    [linkable, rows],
  );
  const verdictColumn = columns.indexOf("Verdict");
  return (
    <div className="overflow-clip rounded-xl bg-card ring-1 ring-foreground/10">
      <Table>
        {props.caption ? <caption className="sr-only">{props.caption}</caption> : null}
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {columns.map((column) => (
              <TableHead key={column} scope="col" className="px-3 text-xs text-muted-foreground">
                {column}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, i) => {
            const id = anchors.get(row[0]);
            return (
              <TableRow
                // biome-ignore lint/suspicious/noArrayIndexKey: the rows have no id of their own and are never reordered
                key={i}
                id={id}
                className="group/anchor scroll-mt-24 target:bg-primary/10 target:outline-2 target:-outline-offset-2 target:outline-primary"
              >
                {row.map((cell, j) => {
                  const verdict = j === verdictColumn ? VERDICTS[cell] : undefined;
                  return (
                    // biome-ignore lint/suspicious/noArrayIndexKey: a static list
                    <TableCell key={j} className="px-3 py-2.5 align-top whitespace-normal">
                      {verdict ? (
                        <span className={cn("inline-flex items-center gap-1.5 font-medium", verdict.tint)}>
                          <verdict.icon aria-hidden className="size-4" />
                          {cell}
                        </span>
                      ) : j === 0 && id ? (
                        <span className="inline-flex items-center gap-1">
                          {cell}
                          <AnchorLink id={id} label={cell} />
                        </span>
                      ) : (
                        cell
                      )}
                    </TableCell>
                  );
                })}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

// ---- the plain building blocks of a report ----
// Drawn by us rather than taken from @json-render/shadcn: that package is one object holding some forty components with Radix, a carousel
// and a drawer, and importing any of them loads all of them. The catalog (what a report may contain, and how it is checked) still comes
// from json-render; these only draw what the catalog lets through.

const GAPS = { none: "gap-0", sm: "gap-2", md: "gap-3", lg: "gap-4", xl: "gap-6" } as const;
const ALIGNS = { start: "items-start", center: "items-center", end: "items-end", stretch: "items-stretch" } as const;
const JUSTIFIES = { start: "", center: "justify-center", end: "justify-end", between: "justify-between", around: "justify-around" } as const;
// one column on a phone, so that cards and tables keep their width; the model's choice of columns from `sm` up (full class names, for Tailwind to find)
const COLUMNS = [
  "grid-cols-1",
  "grid-cols-1 sm:grid-cols-2",
  "grid-cols-1 sm:grid-cols-3",
  "grid-cols-1 sm:grid-cols-4",
  "grid-cols-1 sm:grid-cols-5",
  "grid-cols-1 sm:grid-cols-6",
];

type Children = { children?: ReactNode };

export function ReportStack({
  props,
  children,
}: { props: { direction?: string | null; gap?: string | null; align?: string | null; justify?: string | null } } & Children) {
  return (
    <div
      className={cn(
        "flex",
        props.direction === "horizontal" ? "flex-row flex-wrap" : "flex-col",
        GAPS[(props.gap ?? "md") as keyof typeof GAPS] ?? "gap-3",
        ALIGNS[(props.align ?? "start") as keyof typeof ALIGNS] ?? "items-start",
        JUSTIFIES[(props.justify ?? "start") as keyof typeof JUSTIFIES] ?? "",
      )}
    >
      {children}
    </div>
  );
}

export function ReportGrid({ props, children }: { props: { columns?: number | null; gap?: string | null } } & Children) {
  const columns = Math.max(1, Math.min(6, Math.round(props.columns ?? 1)));
  return <div className={cn("grid", COLUMNS[columns - 1], GAPS[(props.gap ?? "md") as keyof typeof GAPS] ?? "gap-3")}>{children}</div>;
}

export function ReportCard({ props, children }: { props: { title?: string | null; description?: string | null } } & Children) {
  return (
    <Card className="w-full">
      {props.title || props.description ? (
        <CardHeader>
          {props.title ? <CardTitle>{props.title}</CardTitle> : null}
          {props.description ? <CardDescription>{props.description}</CardDescription> : null}
        </CardHeader>
      ) : null}
      <CardContent className="flex flex-col gap-3">{children}</CardContent>
    </Card>
  );
}

export function ReportSeparator({ props }: { props: { orientation?: string | null } }) {
  const vertical = props.orientation === "vertical";
  return (
    <hr
      aria-orientation={vertical ? "vertical" : "horizontal"}
      className={cn("shrink-0 border-0 bg-border", vertical ? "mx-2 h-full w-px" : "my-3 h-px w-full")}
    />
  );
}

const TEXTS = {
  caption: "text-xs",
  muted: "text-sm text-muted-foreground",
  lead: "text-xl text-muted-foreground",
  code: "font-mono text-sm bg-muted px-1.5 py-0.5 rounded",
  body: "text-sm",
} as const;

export function ReportText({ props }: { props: { text: string; variant?: string | null } }) {
  const style = TEXTS[(props.variant ?? "body") as keyof typeof TEXTS] ?? TEXTS.body;
  return props.variant === "code" ? (
    <code className={cn(style, "text-left")}>{props.text}</code>
  ) : (
    <p className={cn(style, "text-left")}>{props.text}</p>
  );
}

export function ReportBadge({ props }: { props: { text: string; variant?: string | null } }) {
  const variant = (["default", "secondary", "destructive", "outline"] as const).find((name) => name === props.variant) ?? "default";
  return <Badge variant={variant}>{props.text}</Badge>;
}

export function ReportProgress({ props }: { props: { value: number; max?: number | null; label?: string | null } }) {
  const max = props.max && props.max > 0 ? props.max : 100;
  const value = Math.min(max, Math.max(0, props.value || 0));
  return (
    <div className="flex flex-col gap-2">
      {props.label ? <span className="text-sm text-muted-foreground">{props.label}</span> : null}
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-label={props.label ?? undefined}
        className="h-2 overflow-hidden rounded-full bg-muted"
      >
        <div className="h-full rounded-full bg-primary" style={{ width: `${(value / max) * 100}%` }} />
      </div>
    </div>
  );
}

// a native <details>: it opens and closes with the keyboard and is announced as a disclosure, with no script
function Summary({ className, children }: { className: string; children: ReactNode }) {
  return (
    <summary
      className={cn(
        "flex w-full cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden",
        className,
      )}
    >
      {children}
      <ChevronDown aria-hidden className="size-4 shrink-0 transition-transform group-open/details:rotate-180" />
    </summary>
  );
}

export function ReportCollapsible({ props, children }: { props: { title: string; defaultOpen?: boolean | null } } & Children) {
  return (
    <details open={props.defaultOpen ?? false} className="group/details w-full rounded-lg border">
      <Summary className="rounded-lg px-4 py-2">{props.title}</Summary>
      <div className="px-4 pt-2 pb-4">{children}</div>
    </details>
  );
}

export function ReportAccordion({ props }: { props: { items: { title: string; content: string }[]; type?: string | null } }) {
  const group = useId();
  const single = props.type !== "multiple";
  return (
    <div className="w-full divide-y rounded-lg border">
      {(props.items ?? []).map((item, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a static list; the items have no id
        <details key={i} name={single ? group : undefined} className="group/details">
          <Summary className="px-4 py-3">{item.title}</Summary>
          <p className="px-4 pb-4 text-sm text-muted-foreground">{item.content}</p>
        </details>
      ))}
    </div>
  );
}
