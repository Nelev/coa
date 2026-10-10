const POLL_MS = 1000;
const HIDDEN_POLL_MS = 5000; // a background tab still has to keep its title count and announcements current, just less eagerly
const MAX_BACKOFF_MS = 30_000;

// how long to wait before asking again: each failure in a row doubles the wait
export function pollDelay(failures: number, hidden: boolean): number {
  return Math.min((hidden ? HIDDEN_POLL_MS : POLL_MS) * 2 ** failures, MAX_BACKOFF_MS);
}

// what the loop needs to know of the page, so that it can be tested without one
export type Page = { hidden: () => boolean; onShown: (callback: () => void) => () => void };

const browserPage: Page = {
  hidden: () => document.hidden,
  onShown(callback) {
    const listener = () => document.hidden || callback();
    document.addEventListener("visibilitychange", listener);
    return () => document.removeEventListener("visibilitychange", listener);
  },
};

// Calls `refresh` again and again until the returned function is called; it says whether the server answered. A failure
// slows the loop down, an answer speeds it up again, and a tab that comes back to the front refreshes at once.
export function startPolling(refresh: () => Promise<boolean>, page: Page = browserPage): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let failures = 0;
  let stopped = false;

  const schedule = (delay: number) => {
    clearTimeout(timer); // never more than one wait pending, however many refreshes end around the same time
    if (!stopped) timer = setTimeout(tick, delay);
  };
  async function tick() {
    failures = (await refresh()) ? 0 : failures + 1;
    schedule(pollDelay(failures, page.hidden()));
  }

  schedule(pollDelay(0, page.hidden()));
  const offShown = page.onShown(() => schedule(0));
  return () => {
    stopped = true;
    clearTimeout(timer);
    offShown();
  };
}
