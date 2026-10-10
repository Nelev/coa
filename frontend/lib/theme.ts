export type Theme = "light" | "dark" | "system";

export const THEME_COOKIE = "theme";

export function parseTheme(value: string | undefined): Theme {
  return value === "light" || value === "dark" ? value : "system";
}

// Runs in <head>, before the first paint, so "system" never flashes the wrong theme. A chosen theme is already on <html> from the
// server; this only settles the "system" case (and repeats a chosen one harmlessly).
export const THEME_SCRIPT = `(function(){try{var m=document.cookie.match(/(?:^|; )${THEME_COOKIE}=(light|dark)/);var d=m?m[1]==="dark":matchMedia("(prefers-color-scheme: dark)").matches;document.documentElement.classList.toggle("dark",d)}catch(e){}})()`;
