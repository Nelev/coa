import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// both palettes are declared in app/globals.css (:root is the light one, .dark the dark one); this keeps their text and UI colors readable
const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const themes = {
  light: css.slice(css.indexOf(":root {"), css.indexOf(".dark {")),
  dark: css.slice(css.indexOf(".dark {"), css.indexOf("@layer base")),
};

type Oklch = [number, number, number];
type Rgb = [number, number, number]; // gamma-encoded sRGB, 0..1

function token(theme: keyof typeof themes, name: string): Oklch {
  const match = themes[theme].match(new RegExp(`--${name}: oklch\\(([\\d.]+) ([\\d.]+) ([\\d.]+)\\)`));
  if (!match) throw new Error(`no opaque oklch token --${name} in the ${theme} theme`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

// oklch -> linear sRGB (Björn Ottosson's matrices), clamped to the gamut
function linear([l, c, h]: Oklch): Rgb {
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ].map((v) => Math.min(1, Math.max(0, v))) as Rgb;
}

const encode = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
const decode = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const srgb = (color: Oklch): Rgb => linear(color).map(encode) as Rgb;

// what a browser draws for `alpha` of the foreground over the background: it blends the encoded values
const over = (foreground: Oklch, background: Oklch, alpha: number): Rgb =>
  srgb(foreground).map((v, i) => alpha * v + (1 - alpha) * srgb(background)[i]) as Rgb;

const luminance = ([r, g, b]: Rgb) => 0.2126 * decode(r) + 0.7152 * decode(g) + 0.0722 * decode(b);

function ratio(a: Rgb, b: Rgb) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe.each(Object.keys(themes) as (keyof typeof themes)[])("%s palette", (theme) => {
  const t = (name: string) => token(theme, name);
  const surfaces = ["background", "card", "muted"];

  it.each(surfaces)("keeps text readable (AA, 4.5:1) on %s", (surface) => {
    for (const text of ["foreground", "muted-foreground", "subtle-foreground"])
      expect(ratio(srgb(t(text)), srgb(t(surface))), `${text} on ${surface}`).toBeGreaterThanOrEqual(4.5);
  });

  it.each(surfaces)("keeps the status colors readable (AA) on %s", (surface) => {
    for (const status of ["success", "warning", "destructive", "info", "primary"])
      expect(ratio(srgb(t(status)), srgb(t(surface))), `${status} on ${surface}`).toBeGreaterThanOrEqual(4.5);
  });

  // badges and soft buttons tint their own background with the status color (up to 20%)
  it.each(["success", "warning", "destructive", "info"])("keeps %s readable on its own tint", (status) => {
    for (const surface of ["card", "background"])
      expect(ratio(srgb(t(status)), over(t(status), t(surface), 0.2)), `${status} on ${surface}`).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps the labels on filled buttons readable", () => {
    expect(ratio(srgb(t("primary-foreground")), srgb(t("primary")))).toBeGreaterThanOrEqual(4.5);
    expect(ratio(srgb(t("secondary-foreground")), srgb(t("secondary")))).toBeGreaterThanOrEqual(4.5);
    expect(ratio(srgb(t("accent-foreground")), srgb(t("accent")))).toBeGreaterThanOrEqual(4.5);
  });

  // WCAG 1.4.11: what shows a control is there (its border, its focus ring) reaches 3:1 against what is around it
  it.each(["background", "card"])("draws form-field borders and the focus ring at 3:1 on %s", (surface) => {
    expect(ratio(srgb(t("field")), srgb(t(surface))), "field").toBeGreaterThanOrEqual(3);
    expect(ratio(srgb(t("ring")), srgb(t(surface))), "ring").toBeGreaterThanOrEqual(3);
  });
});
