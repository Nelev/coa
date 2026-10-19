import { describe, expect, it } from "vitest";

import { mapLimit } from "@/lib/uploads";

describe("mapLimit", () => {
  it("never runs more than the limit at once, and runs everything", async () => {
    let running = 0;
    let most = 0;
    const results = await mapLimit([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      running += 1;
      most = Math.max(most, running);
      await new Promise((resolve) => setTimeout(resolve, 5));
      running -= 1;
      return n * 2;
    });
    expect(most).toBe(3);
    expect(results).toEqual([2, 4, 6, 8, 10, 12, 14]);
  });

  it("returns the results in the order of the items, however long each takes", async () => {
    const delays = [30, 1, 15];
    const results = await mapLimit(delays, 2, async (ms) => {
      await new Promise((resolve) => setTimeout(resolve, ms));
      return ms;
    });
    expect(results).toEqual(delays);
  });

  it("does nothing for no items", async () => {
    expect(await mapLimit([], 3, async (n: number) => n)).toEqual([]);
  });
});
