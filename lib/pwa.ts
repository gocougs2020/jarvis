import { appConfig } from "../app.config";

/** Light/dark browser chrome colors (`theme.browserColor` in `app.config.ts`). Match `--background`. */
export const pwaThemeColor: { readonly light: string; readonly dark: string } = appConfig.theme.browserColor;

export const pwaIconSizes = {
  "192": { size: 192, maskable: false },
  "512": { size: 512, maskable: false },
  "512-maskable": { size: 512, maskable: true },
} as const;

export type PwaIconSize = keyof typeof pwaIconSizes;

export function isPwaIconSize(value: string): value is PwaIconSize {
  return value in pwaIconSizes;
}
