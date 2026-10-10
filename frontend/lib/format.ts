// 1.8s, 42.0s, 1m 05s; below a second the exact milliseconds
export function formatDuration(ms: number) {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = ms / 1000;
  return seconds < 60 ? `${seconds.toFixed(1)}s` : `${Math.floor(seconds / 60)}m ${String(Math.floor(seconds % 60)).padStart(2, "0")}s`;
}

// just now, 5 min ago, 3 h ago, 2 d ago; older than a week: the date
export function relativeTime(timestamp: number, now: number) {
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days <= 7 ? `${days} d ago` : new Date(timestamp).toLocaleDateString();
}

const MOMENT = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "medium" });

// Oct 9, 2026, 1:43:52 PM
export function formatMoment(time: number) {
  return MOMENT.format(time);
}
