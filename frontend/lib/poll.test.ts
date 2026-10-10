import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Page, pollDelay, startPolling } from "@/lib/poll";

describe("pollDelay", () => {
  it("asks every second, every five seconds in a background tab", () => {
    expect(pollDelay(0, false)).toBe(1000);
    expect(pollDelay(0, true)).toBe(5000);
  });

  it("doubles the wait with each failure in a row, up to 30 seconds", () => {
    expect([1, 2, 3, 4, 5, 6].map((failures) => pollDelay(failures, false))).toEqual([2000, 4000, 8000, 16_000, 30_000, 30_000]);
    expect(pollDelay(1, true)).toBe(10_000);
  });
});

describe("startPolling", () => {
  let hidden = false;
  let show = () => {};
  const page: Page = {
    hidden: () => hidden,
    onShown(callback) {
      show = callback;
      return () => {
        show = () => {};
      };
    },
  };

  beforeEach(() => {
    vi.useFakeTimers();
    hidden = false;
  });
  afterEach(() => vi.useRealTimers());

  it("refreshes every second while the server answers", async () => {
    const refresh = vi.fn().mockResolvedValue(true);
    const stop = startPolling(refresh, page);

    await vi.advanceTimersByTimeAsync(3500);
    expect(refresh).toHaveBeenCalledTimes(3);
    stop();
  });

  it("slows down while the server cannot be reached and speeds up again once it answers", async () => {
    const refresh = vi.fn().mockResolvedValue(false);
    const stop = startPolling(refresh, page);

    await vi.advanceTimersByTimeAsync(1000); // fails: the next wait is 2 s
    await vi.advanceTimersByTimeAsync(1999);
    expect(refresh).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); // fails again: 4 s
    expect(refresh).toHaveBeenCalledTimes(2);

    refresh.mockResolvedValue(true);
    await vi.advanceTimersByTimeAsync(4000); // answers: back to 1 s
    await vi.advanceTimersByTimeAsync(1000);
    expect(refresh).toHaveBeenCalledTimes(4);
    stop();
  });

  it("waits longer in a background tab and refreshes at once when the tab comes back", async () => {
    hidden = true;
    const refresh = vi.fn().mockResolvedValue(true);
    const stop = startPolling(refresh, page);

    await vi.advanceTimersByTimeAsync(4999);
    expect(refresh).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(refresh).toHaveBeenCalledTimes(1);

    hidden = false;
    show();
    await vi.advanceTimersByTimeAsync(0);
    expect(refresh).toHaveBeenCalledTimes(2);
    stop();
  });

  it("keeps one wait pending when a refresh ends while the tab comes back", async () => {
    const refresh = vi.fn().mockResolvedValue(true);
    const stop = startPolling(refresh, page);

    show();
    show();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(3000);
    expect(refresh).toHaveBeenCalledTimes(4); // once at the start of the shows, then once a second: not once per show
    stop();
  });

  it("stops for good", async () => {
    const refresh = vi.fn().mockResolvedValue(true);
    const stop = startPolling(refresh, page);
    stop();

    await vi.advanceTimersByTimeAsync(10_000);
    show();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(refresh).not.toHaveBeenCalled();
  });
});
