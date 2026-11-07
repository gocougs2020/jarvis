import { describe, expect, it } from "vitest";
import { appConfig } from "../app.config";
import { applyConfigOverrides, isSafeCssValue } from "./config-overrides";
import { themeStyleSheet } from "./theme-css";

const defaults = {
  brand: { name: "Jarvis", tagline: "Default" },
  theme: { brandColor: null as string | null, radius: null as string | null, light: {}, dark: {} },
  models: { chatFast: "a/b", contextWindows: { "a/b": 100 } },
  quickReply: { enabled: true, maxAnswerTokens: 1200 },
  skills: { write: { enabled: true, suggest: true } },
  security: { sandboxNetwork: "deny-all" as string | readonly string[] },
  resendInbox: { triageActions: ["add_labels"] as readonly string[] },
};

describe("applyConfigOverrides", () => {
  it("returns the defaults untouched when nothing is set", () => {
    expect(applyConfigOverrides(defaults, {})).toBe(defaults);
    expect(applyConfigOverrides(defaults, { json: "  ", name: "" })).toBe(defaults);
  });

  it("deep-merges JSON without dropping sibling keys", () => {
    const merged = applyConfigOverrides(defaults, {
      json: JSON.stringify({ brand: { name: "Friday" }, skills: { write: { suggest: false } } }),
    });
    expect(merged.brand).toEqual({ name: "Friday", tagline: "Default" });
    expect(merged.skills.write).toEqual({ enabled: true, suggest: false });
    expect(defaults.brand.name).toBe("Jarvis");
  });

  it("applies the shortcut variables over the JSON", () => {
    const merged = applyConfigOverrides(defaults, {
      json: JSON.stringify({ brand: { name: "From JSON", tagline: "Kept" } }),
      name: " Friday ",
      brandColor: "#2f629f",
    });
    expect(merged.brand).toEqual({ name: "Friday", tagline: "Kept" });
    expect(merged.theme.brandColor).toBe("#2f629f");
  });

  it("allows new keys only in open maps", () => {
    const merged = applyConfigOverrides(defaults, {
      json: JSON.stringify({
        models: { contextWindows: { "c/d": 200 } },
        theme: { light: { primary: "oklch(0.5 0.2 250)" } },
      }),
    });
    expect(merged.models.contextWindows).toEqual({ "a/b": 100, "c/d": 200 });
    expect(merged.theme.light).toEqual({ primary: "oklch(0.5 0.2 250)" });

    expect(() => applyConfigOverrides(defaults, { json: '{"brand":{"logo":"x"}}' })).toThrow(
      /brand\.logo: not a setting/,
    );
    expect(() => applyConfigOverrides(defaults, { json: '{"skills":{"new-skill":{}}}' })).toThrow(
      /skills\.new-skill: not a setting/,
    );
  });

  it("rejects wrong types and reports every problem at once", () => {
    const run = () =>
      applyConfigOverrides(defaults, {
        json: JSON.stringify({
          quickReply: { enabled: "no", maxAnswerTokens: "10" },
          resendInbox: { triageActions: "archive" },
        }),
      });
    expect(run).toThrow(/quickReply\.enabled: expected boolean/);
    expect(run).toThrow(/quickReply\.maxAnswerTokens: expected number/);
    expect(run).toThrow(/resendInbox\.triageActions: expected an array/);
  });

  it("accepts a string or a host list for the sandbox network", () => {
    expect(
      applyConfigOverrides(defaults, { json: '{"security":{"sandboxNetwork":["pypi.org"]}}' }).security
        .sandboxNetwork,
    ).toEqual(["pypi.org"]);
    expect(() => applyConfigOverrides(defaults, { json: '{"security":{"sandboxNetwork":1}}' })).toThrow();
  });

  it("refuses invalid JSON and non-objects", () => {
    expect(() => applyConfigOverrides(defaults, { json: "{brand:" })).toThrow(/not valid JSON/);
    expect(() => applyConfigOverrides(defaults, { json: "[1]" })).toThrow(/must be a JSON object/);
  });

  it("refuses CSS that could escape the style tag", () => {
    expect(() => applyConfigOverrides(defaults, { brandColor: "red;}</style><script>" })).toThrow(
      /theme\.brandColor: expected a CSS color/,
    );
    expect(() =>
      applyConfigOverrides(defaults, { json: '{"theme":{"light":{"x;y":"red"}}}' }),
    ).toThrow(/theme token names/);
  });
});

describe("isSafeCssValue", () => {
  it.each(["#2f629f", "oklch(0.55 0.15 250)", "rgb(0 0 0 / 10%)", "0.5rem", "color-mix(in oklab, red 50%, white)"])(
    "allows %s",
    (value) => expect(isSafeCssValue(value)).toBe(true),
  );
  it.each(["", "red;", "a{b}", "url('x')", "</style>", "\\61"])("refuses %s", (value) =>
    expect(isSafeCssValue(value)).toBe(false),
  );
});

describe("themeStyleSheet", () => {
  const base = appConfig.theme;

  it("is empty for the default theme", () => {
    expect(themeStyleSheet(base)).toBe("");
  });

  it("applies the brand color to both modes and keeps light values out of dark mode", () => {
    const css = themeStyleSheet({ ...base, brandColor: "#2f629f", light: { background: "#fff" }, radius: "0.5rem" });
    expect(css).toContain("html:root{--radius:0.5rem}");
    expect(css).toContain("html:not(.dark){--primary:#2f629f;--primary-foreground:#ffffff;--ring:#2f629f;--background:#fff}");
    expect(css).toContain("html.dark{--primary:#2f629f;--primary-foreground:#ffffff;--ring:#2f629f}");
  });

  it("lets a per-mode token win over the brand color", () => {
    const css = themeStyleSheet({ ...base, brandColor: "#2f629f", dark: { primary: "#9ab8de" } });
    expect(css).toContain("html.dark{--primary:#9ab8de;--primary-foreground:#ffffff;--ring:#2f629f}");
  });
});
