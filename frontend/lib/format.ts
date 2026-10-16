// 1.8s, 42.0s, 1m 05s; below a second the exact milliseconds
export function formatDuration(ms: number) {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = ms / 1000;
  return seconds < 60 ? `${seconds.toFixed(1)}s` : `${Math.floor(seconds / 60)}m ${String(Math.floor(seconds % 60)).padStart(2, "0")}s`;
}

// 842, 12.4k, 1.2M
export function formatTokens(count: number) {
  if (count < 1000) return String(count);
  return count < 1_000_000 ? `${(count / 1000).toFixed(1)}k` : `${(count / 1_000_000).toFixed(1)}M`;
}

// US dollars: a run costs fractions of a cent, so below one cent the four decimals that show it are kept ($0.0031, $0.12)
export function formatCost(usd: number) {
  if (usd > 0 && usd < 0.0001) return "<$0.0001";
  return usd === 0 || usd >= 0.01 ? `$${usd.toFixed(2)}` : `$${usd.toFixed(4)}`;
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
