import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// the dark palette is declared in app/globals.css; this keeps its text and UI colors readable
const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const dark = css.slice(css.indexOf(".dark {"), css.indexOf("@layer base"));

function token(name: string): [number, number, number] {
  const match = dark.match(new RegExp(`--${name}: oklch\\(([\\d.]+) ([\\d.]+) ([\\d.]+)\\)`));
  if (!match) throw new Error(`no opaque oklch token --${name}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

// oklch -> linear sRGB (Björn Ottosson's matrices), clamped to the gamut
function luminance([l, c, h]: [number, number, number]) {
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const rgb = [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ].map((v) => Math.min(1, Math.max(0, v)));
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}

function contrast(foreground: string, background: string) {
  const [a, b] = [luminance(token(foreground)), luminance(token(background))].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
}

describe("dark palette", () => {
  const surfaces = ["background", "card", "muted"];

  it.each(surfaces)("keeps text readable (AA, 4.5:1) on %s", (surface) => {
    for (const text of ["foreground", "muted-foreground", "subtle-foreground"])
      expect(contrast(text, surface), `${text} on ${surface}`).toBeGreaterThanOrEqual(4.5);
  });

  it.each(surfaces)("keeps the status colors readable (AA) on %s", (surface) => {
    for (const status of ["success", "warning", "destructive", "info", "primary"])
      expect(contrast(status, surface), `${status} on ${surface}`).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps the label on the primary button readable", () => {
    expect(contrast("primary-foreground", "primary")).toBeGreaterThanOrEqual(4.5);
  });
});
