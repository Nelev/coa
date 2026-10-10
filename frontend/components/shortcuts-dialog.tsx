import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

const SHORTCUTS: { keys: string[]; does: string }[] = [
  { keys: ["j"], does: "Focus the next run" },
  { keys: ["k"], does: "Focus the previous run" },
  { keys: ["Enter"], does: "Open the focused run" },
  { keys: ["/"], does: "Search the runs" },
  { keys: ["?"], does: "Show this list" },
  { keys: ["Esc"], does: "Close this list" },
];

export function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <div className="flex flex-col gap-1">
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>On the list of runs. They are off while you type in a field.</DialogDescription>
        </div>
        <dl className="flex flex-col divide-y text-sm">
          {SHORTCUTS.map(({ keys, does }) => (
            <div key={does} className="flex items-center justify-between gap-4 py-2">
              <dt className="text-muted-foreground">{does}</dt>
              <dd className="flex gap-1">
                {keys.map((key) => (
                  <kbd key={key} className="min-w-6 rounded-md border bg-muted px-1.5 py-0.5 text-center font-mono text-xs text-foreground">
                    {key}
                  </kbd>
                ))}
              </dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  );
}
