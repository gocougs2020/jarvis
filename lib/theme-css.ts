import type { AppConfig, ThemeToken } from "../app.config";
import { isSafeCssValue } from "./config-overrides";

type Theme = AppConfig["theme"];
type Tokens = Partial<Record<ThemeToken, string>>;

function declarations(tokens: Readonly<Record<string, string | undefined>>): string {
  return Object.entries(tokens)
    .filter((entry): entry is [string, string] => typeof entry[1] === "string" && isSafeCssValue(entry[1]))
    .map(([name, value]) => `--${name}:${value}`)
    .join(";");
}

/**
 * CSS that layers `appConfig.theme` over the defaults in `app/globals.css`.
 * Returns an empty string when the theme is untouched, so the default build
 * renders no extra tag. Each selector is more specific than its counterpart
 * in `globals.css` (`html:not(.dark)` over `:root`, `html.dark` over
 * `.dark`), so it wins regardless of the order the stylesheets load in, and
 * light-mode values never leak into dark mode.
 */
export function themeStyleSheet(theme: Theme): string {
  const brand: Tokens = theme.brandColor
    ? { primary: theme.brandColor, "primary-foreground": theme.brandForeground, ring: theme.brandColor }
    : {};
  const shared = declarations(theme.radius ? { radius: theme.radius } : {});
  const light = declarations({ ...brand, ...theme.light });
  const dark = declarations({ ...brand, ...theme.dark });

  return [
    shared && `html:root{${shared}}`,
    light && `html:not(.dark){${light}}`,
    dark && `html.dark{${dark}}`,
  ]
    .filter(Boolean)
    .join("");
}
