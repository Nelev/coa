import { CircleCheck, Layers, Loader2, TriangleAlert } from "lucide-react";
import type { Filter, Tally } from "@/lib/runs";
import { cn } from "@/lib/utils";

type Tile = { filter: Filter; label: string; count: number; detail: string; icon: React.ReactNode; tone: string };

function tiles(tally: Tally): Tile[] {
  const attention = [tally.nonConforming && `${tally.nonConforming} non-conforming`, tally.review && `${tally.review} to review`].filter(Boolean);
  return [
    { filter: "all", label: "All runs", count: tally.all, detail: "everything uploaded", icon: <Layers />, tone: "text-foreground" },
    {
      filter: "attention",
      label: "Needs attention",
      count: tally.attention,
      detail: attention.join(" · ") || (tally.attention ? "failed or unclear" : "nothing to check"),
      icon: <TriangleAlert />,
      tone: tally.attention ? "text-warning" : "text-subtle-foreground",
    },
    {
      filter: "progress",
      label: "In progress",
      count: tally.progress,
      detail: tally.queued ? `${tally.queued} queued` : "being analyzed",
      icon: <Loader2 className={tally.progress ? "animate-spin motion-reduce:animate-none" : ""} />,
      tone: tally.progress ? "text-info" : "text-subtle-foreground",
    },
    {
      filter: "conforming",
      label: "Conforming",
      count: tally.conforming,
      detail: "ready to accept",
      icon: <CircleCheck />,
      tone: tally.conforming ? "text-success" : "text-subtle-foreground",
    },
  ];
}

// the counts double as the filters of the list: pressing one shows those runs, pressing it again shows all
export function FilterTiles({ tally, filter, onChange }: { tally: Tally; filter: Filter; onChange: (filter: Filter) => void }) {
  return (
    <fieldset className="min-w-0 grid grid-cols-2 gap-3 lg:grid-cols-4">
      <legend className="sr-only">Filter runs</legend>
      {tiles(tally).map((tile) => {
        const pressed = filter === tile.filter;
        return (
          <button
            key={tile.filter}
            type="button"
            aria-pressed={pressed}
            onClick={() => onChange(pressed ? "all" : tile.filter)}
            className={cn(
              "flex flex-col gap-1 rounded-xl bg-card p-4 text-left ring-1 ring-foreground/10 outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring",
              pressed && "bg-muted ring-2 ring-primary",
            )}
          >
            <span className={cn("flex items-center gap-2 text-xs font-medium [&_svg]:size-4", tile.tone)}>
              {tile.icon}
              {tile.label}
            </span>
            <span className="text-2xl font-semibold tabular-nums">{tile.count}</span>
            <span className="truncate text-xs text-subtle-foreground">{tile.detail}</span>
          </button>
        );
      })}
    </fieldset>
  );
}
