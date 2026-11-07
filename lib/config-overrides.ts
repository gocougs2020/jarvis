/**
 * Deploy-time overrides for `app.config.ts`.
 *
 * One repo can serve many deployments: the upstream project, your own
 * production site, and other people's forks. Each deployment sets a few
 * `NEXT_PUBLIC_*` environment variables instead of editing `app.config.ts`,
 * so pulling upstream never conflicts with a customized config.
 *
 * - `NEXT_PUBLIC_APP_CONFIG`: JSON, deep-merged over `app.config.ts`. Any key
 *   the file defines can be set; unknown keys and wrong types fail the build.
 * - `NEXT_PUBLIC_APP_NAME`, `NEXT_PUBLIC_APP_TAGLINE`, `NEXT_PUBLIC_BRAND_COLOR`:
 *   shortcuts for `brand.name`, `brand.tagline`, and `theme.brandColor`. They
 *   win over the same keys in the JSON.
 *
 * Everything here reaches the browser (Next.js inlines `NEXT_PUBLIC_*` at
 * build time), so it is for product defaults only: never secrets, emails, or
 * access lists. Changing a value needs a redeploy.
 */

type Plain = Record<string, unknown>;

export type ConfigOverrideInput = {
  /** Raw `NEXT_PUBLIC_APP_CONFIG`. */
  readonly json?: string;
  readonly name?: string;
  readonly tagline?: string;
  readonly brandColor?: string;
};

/**
 * Objects whose keys are open-ended (a map, not a fixed shape), so an override
 * may add a key the defaults do not list.
 */
const OPEN_MAPS = new Set(["models.contextWindows", "theme.light", "theme.dark"]);

/** Paths whose value may be either a string or an array of strings. */
const STRING_OR_LIST = new Set(["security.sandboxNetwork"]);

/** Paths that hold CSS colors or lengths and are written into a <style> tag. */
function isCssPath(path: string): boolean {
  return (
    path.startsWith("theme.light.") ||
    path.startsWith("theme.dark.") ||
    path === "theme.brandColor" ||
    path === "theme.brandForeground" ||
    path === "theme.radius" ||
    path.startsWith("theme.browserColor.") ||
    path.startsWith("theme.icon.")
  );
}

/**
 * A CSS value safe to drop into a declaration: colors (`#2f629f`,
 * `oklch(0.5 0.2 250)`, `rgb(0 0 0 / 10%)`), lengths (`0.5rem`), and
 * `color-mix(...)`. Anything that could close the declaration or the tag is
 * refused.
 */
export function isSafeCssValue(value: string): boolean {
  return value.length > 0 && value.length <= 120 && /^[#a-zA-Z0-9(),.%/\s+-]+$/.test(value);
}

function isPlain(value: unknown): value is Plain {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function describe(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function mergeInto(base: unknown, override: unknown, path: string, errors: string[]): unknown {
  if (isCssPath(path) && override !== null) {
    if (typeof override !== "string" || !isSafeCssValue(override)) {
      errors.push(`${path}: expected a CSS color or length such as "#2f629f" or "0.5rem"`);
      return base;
    }
    return override;
  }

  if (STRING_OR_LIST.has(path)) {
    const ok =
      typeof override === "string" ||
      (Array.isArray(override) && override.every((item) => typeof item === "string"));
    if (!ok) errors.push(`${path}: expected a string or an array of strings`);
    return ok ? override : base;
  }

  if (isPlain(base)) {
    if (!isPlain(override)) {
      errors.push(`${path || "(root)"}: expected an object, got ${describe(override)}`);
      return base;
    }
    const open = OPEN_MAPS.has(path);
    const result: Plain = { ...base };
    for (const [key, value] of Object.entries(override)) {
      const childPath = path ? `${path}.${key}` : key;
      if (!(key in base)) {
        if (!open) {
          errors.push(`${childPath}: not a setting in app.config.ts`);
          continue;
        }
        if (isCssPath(childPath) && !/^[a-z][a-z0-9-]*$/.test(key)) {
          errors.push(`${childPath}: theme token names use lowercase letters, digits, and dashes`);
          continue;
        }
        const added = mergeInto(undefined, value, childPath, errors);
        if (added !== undefined) result[key] = added;
        continue;
      }
      result[key] = mergeInto(base[key], value, childPath, errors);
    }
    return result;
  }

  if (Array.isArray(base)) {
    if (!Array.isArray(override)) {
      errors.push(`${path}: expected an array, got ${describe(override)}`);
      return base;
    }
    return override;
  }

  // A null default (an optional setting) accepts a string or null.
  if (base === null) {
    if (override === null || typeof override === "string") return override;
    errors.push(`${path}: expected a string or null, got ${describe(override)}`);
    return base;
  }

  if (base === undefined) {
    // New entry in an open map: numbers for context windows, strings elsewhere.
    if (typeof override === "string" || typeof override === "number") return override;
    errors.push(`${path}: expected a string or number, got ${describe(override)}`);
    return undefined;
  }

  if (typeof override !== typeof base) {
    errors.push(`${path}: expected ${typeof base}, got ${describe(override)}`);
    return base;
  }
  return override;
}

function setPath(target: Plain, path: readonly string[], value: unknown) {
  let node: Plain = target;
  for (const key of path.slice(0, -1)) {
    const next = node[key];
    node[key] = isPlain(next) ? { ...next } : {};
    node = node[key] as Plain;
  }
  node[path[path.length - 1]!] = value;
}

/**
 * Returns `defaults` with the deployment's overrides applied. Throws one error
 * listing every problem, so a typo fails the build instead of shipping a
 * half-applied config.
 */
export function applyConfigOverrides<T extends object>(defaults: T, input: ConfigOverrideInput): T {
  const errors: string[] = [];
  let parsed: Plain = {};

  const raw = input.json?.trim();
  if (raw) {
    try {
      const value: unknown = JSON.parse(raw);
      if (isPlain(value)) parsed = value;
      else errors.push("NEXT_PUBLIC_APP_CONFIG must be a JSON object");
    } catch (error) {
      errors.push(`NEXT_PUBLIC_APP_CONFIG is not valid JSON (${(error as Error).message})`);
    }
  }

  const shortcuts: [string | undefined, readonly string[]][] = [
    [input.name, ["brand", "name"]],
    [input.tagline, ["brand", "tagline"]],
    [input.brandColor, ["theme", "brandColor"]],
  ];
  for (const [value, path] of shortcuts) {
    const trimmed = value?.trim();
    if (trimmed) setPath(parsed, path, trimmed);
  }

  if (Object.keys(parsed).length === 0 && errors.length === 0) return defaults;

  const merged = mergeInto(defaults, parsed, "", errors);
  if (errors.length > 0) {
    throw new Error(
      `Invalid app config override:\n${errors.map((line) => `  - ${line}`).join("\n")}\n` +
        "Fix NEXT_PUBLIC_APP_CONFIG / NEXT_PUBLIC_APP_NAME / NEXT_PUBLIC_APP_TAGLINE / NEXT_PUBLIC_BRAND_COLOR, then redeploy.",
    );
  }
  return merged as T;
}
