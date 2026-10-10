export type Tone = "success" | "info" | "warning" | "error";

export type ToastInput = { tone: Tone; title: string; description?: string };
export type ToastItem = ToastInput & { id: number };

export const MAX_TOASTS = 4;

// How long a toast stays: a good result goes by itself, a warning stays a little longer, and an error stays until it is dismissed
// (a message that vanishes while it is being read, or before it is read at all, helps nobody). null = no limit.
export function toastDuration(tone: Tone): number | null {
  if (tone === "error") return null;
  return tone === "warning" ? 9000 : 6000;
}

// the newest toast goes last; when there are too many the oldest that can go by itself goes first, and an error is kept as long as there is room
export function addToast(list: ToastItem[], item: ToastItem): ToastItem[] {
  const next = [...list, item];
  while (next.length > MAX_TOASTS) {
    const at = next.findIndex((toast) => toast.tone !== "error");
    next.splice(at === -1 ? 0 : at, 1);
  }
  return next;
}
