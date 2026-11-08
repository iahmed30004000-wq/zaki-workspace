/**
 * The palettes as ONE static stylesheet: src/app/themes.css, written by
 * `npx tsx scripts/build-themes-css.mjs` and imported first by globals.css.
 *
 * Static on purpose. The theme is an attribute the server already puts on <html> from the cookie,
 * so the right palette paints on the first frame with no script; and a stylesheet cannot be
 * mangled the way a React 18 `<style>` text child is (React escapes its quotes and `>`, which
 * breaks selectors). All four palettes together are about 4 KB.
 *
 * Shape: `:root` = the DEFAULT theme (a page rendered without the attribute — an error page, a test
 * render — still has every token), then one `[data-theme="key"]` rule per theme. Same specificity,
 * so the later, attribute rule wins on <html>; and any element can carry `data-theme` to show
 * another theme inside the page (the picker's previews do exactly that). `color-scheme` sits in
 * the same rule so native controls (checkboxes, date pickers, scrollbars) follow the theme.
 */
import { DEFAULT_THEME, THEME_KEYS, THEMES, type ThemeKey } from "./registry";
import { themeFxVariables, themeVariables } from "./palettes";

/** Where the generated stylesheet lives (relative to the repository root). */
export const THEMES_CSS_FILE = "src/app/themes.css";

const HEADER = [
  "/*",
  " * GENERATED FILE - do not edit by hand.",
  " * Source: src/lib/themes/palettes.ts (the colours) and src/lib/themes/registry.ts (the themes).",
  " * Rebuild: npx tsx scripts/build-themes-css.mjs",
  " * tests/themes-css.test.ts fails while this file and the palettes disagree.",
  " */",
].join("\n");

function rule(selector: string, key: ThemeKey): string {
  const lines = [`  color-scheme: ${THEMES[key].dark ? "dark" : "light"};`];
  for (const [name, value] of themeVariables(key)) lines.push(`  ${name}: ${value};`);
  // the illustration colours of «مظهر المفتاح» (palettes.ts FX_TOKENS), after the interface tokens
  for (const [name, value] of themeFxVariables(key)) lines.push(`  ${name}: ${value};`);
  return `${selector} {\n${lines.join("\n")}\n}`;
}

export function renderThemesCss(): string {
  const blocks = [HEADER, rule(":root", DEFAULT_THEME), ...THEME_KEYS.map((key) => rule(`[data-theme="${key}"]`, key))];
  return `${blocks.join("\n\n")}\n`;
}
