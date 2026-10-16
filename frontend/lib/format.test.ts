import { describe, expect, it } from "vitest";
import { formatCost, formatDuration, formatTokens, relativeTime } from "@/lib/format";

describe("formatDuration", () => {
  it.each([
    [420, "420ms"],
    [1800, "1.8s"],
    [42000, "42.0s"],
    [65000, "1m 05s"],
  ])("%ims is %s", (ms, text) => expect(formatDuration(ms)).toBe(text));
});

describe("formatTokens", () => {
  it.each([
    [0, "0"],
    [842, "842"],
    [12_400, "12.4k"],
    [1_250_000, "1.3M"],
  ])("%i is %s", (count, text) => expect(formatTokens(count)).toBe(text));
});

describe("formatCost", () => {
  it.each([
    [0, "$0.00"],
    [0.00002, "<$0.0001"],
    [0.000172, "$0.0002"],
    [0.0031, "$0.0031"],
    [0.0149, "$0.01"],
    [0.12, "$0.12"],
  ])("%d is %s", (usd, text) => expect(formatCost(usd)).toBe(text));
});

describe("relativeTime", () => {
  const now = Date.UTC(2026, 9, 9, 12);
  it.each([
    [10 * 1000, "just now"],
    [5 * 60 * 1000, "5 min ago"],
    [3 * 3600 * 1000, "3 h ago"],
    [2 * 86400 * 1000, "2 d ago"],
  ])("%i ms ago is %s", (ago, text) => expect(relativeTime(now - ago, now)).toBe(text));

  it("shows the date for anything older than a week", () => {
    expect(relativeTime(now - 30 * 86400 * 1000, now)).toMatch(/\d/);
  });
});
