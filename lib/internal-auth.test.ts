import { afterEach, describe, expect, it, vi } from "vitest";
import {
  appOrigin,
  eveSessionIdFromUrl,
  internalDispatchSecret,
  isCrossSiteRequest,
  isInternalDispatchRequest,
  secretsMatch,
} from "@/lib/internal-auth";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("internalDispatchSecret", () => {
  it("prefers EMAIL_SESSION_SECRET", () => {
    vi.stubEnv("EMAIL_SESSION_SECRET", "explicit-secret");
    vi.stubEnv("BETTER_AUTH_SECRET", "auth-secret");
    expect(internalDispatchSecret()).toBe("explicit-secret");
  });

  it("derives from BETTER_AUTH_SECRET without exposing it", () => {
    vi.stubEnv("EMAIL_SESSION_SECRET", "");
    vi.stubEnv("BETTER_AUTH_SECRET", "auth-secret");
    vi.stubEnv("RESEND_WEBHOOK_SECRET", "whsec_dashboard_visible");
    const derived = internalDispatchSecret();
    expect(derived).toMatch(/^[0-9a-f]{64}$/);
    expect(derived).not.toContain("auth-secret");
    expect(isInternalDispatchRequest("whsec_dashboard_visible")).toBe(false);
    expect(isInternalDispatchRequest(derived)).toBe(true);
  });

  it("is null with no auth secret", () => {
    vi.stubEnv("EMAIL_SESSION_SECRET", "");
    vi.stubEnv("BETTER_AUTH_SECRET", "");
    expect(internalDispatchSecret()).toBeNull();
    expect(isInternalDispatchRequest("anything")).toBe(false);
  });
});

describe("secretsMatch", () => {
  it("rejects empty and mismatched values", () => {
    expect(secretsMatch("", "a")).toBe(false);
    expect(secretsMatch("a", null)).toBe(false);
    expect(secretsMatch("a", "b")).toBe(false);
    expect(secretsMatch("same", "same")).toBe(true);
  });
});

describe("appOrigin", () => {
  it("uses configuration only", () => {
    vi.stubEnv("BETTER_AUTH_URL", "https://jarvis.example.com/");
    expect(appOrigin()).toBe("https://jarvis.example.com");
  });
});

describe("eveSessionIdFromUrl", () => {
  it("finds the session id on continue, stream, and control routes", () => {
    expect(eveSessionIdFromUrl("https://x.test/eve/v1/session/wrun_A")).toBe("wrun_A");
    expect(eveSessionIdFromUrl("https://x.test/eve/v1/session/wrun_A/stream?from=3")).toBe("wrun_A");
    expect(eveSessionIdFromUrl("/eve/v1/session/wrun_A/reset")).toBe("wrun_A");
  });

  it("is null when starting a session", () => {
    expect(eveSessionIdFromUrl("https://x.test/eve/v1/session")).toBeNull();
    expect(eveSessionIdFromUrl("https://x.test/api/chats")).toBeNull();
  });
});

describe("isCrossSiteRequest", () => {
  const url = "http://localhost:3000/api/setup";
  it("trusts same-origin and direct navigations", () => {
    expect(isCrossSiteRequest(new Request(url, { headers: { "sec-fetch-site": "same-origin" } }))).toBe(false);
    expect(isCrossSiteRequest(new Request(url, { headers: { origin: "http://localhost:3000" } }))).toBe(false);
    expect(isCrossSiteRequest(new Request(url))).toBe(false);
  });

  it("flags other sites", () => {
    expect(isCrossSiteRequest(new Request(url, { headers: { "sec-fetch-site": "cross-site" } }))).toBe(true);
    expect(isCrossSiteRequest(new Request(url, { headers: { origin: "https://evil.test" } }))).toBe(true);
    expect(isCrossSiteRequest(new Request(url, { headers: { origin: "null" } }))).toBe(true);
  });
});
