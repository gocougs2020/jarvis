import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  canWriteLocalEnv,
  getSetupStatus,
  isCanonicalProductionAuthUrl,
  isHostedOnVercel,
  isSetupScreenVisible,
  nextOpenRequiredSetupStep,
  shouldShowRequiredSetupStep,
  visibleRequiredSetupSteps,
} from "@/lib/setup-status";

const SETUP_ENV_KEYS = [
  "OWNER_EMAIL",
  "BETTER_AUTH_SECRET",
  "BETTER_AUTH_URL",
  "AI_GATEWAY_API_KEY",
  "DATABASE_URL",
  "BLOB_READ_WRITE_TOKEN",
  "BLOB_STORE_ID",
  "VERCEL_BLOB_STORE_ID",
  "OPENAI_API_KEY",
  "RESEND_API_KEY",
  "RESEND_FROM_EMAIL",
  "VERCEL",
  "NODE_ENV",
] as const;

const originalEnv: Partial<Record<(typeof SETUP_ENV_KEYS)[number], string | undefined>> = {};

function envStore(): Record<string, string | undefined> {
  return process.env as Record<string, string | undefined>;
}

function clearSetupEnv() {
  const env = envStore();
  for (const key of SETUP_ENV_KEYS) {
    delete env[key];
  }
}

beforeEach(() => {
  const env = envStore();
  for (const key of SETUP_ENV_KEYS) {
    originalEnv[key] = env[key];
  }
  clearSetupEnv();
  env.NODE_ENV = "test";
});

afterEach(() => {
  const env = envStore();
  clearSetupEnv();
  for (const key of SETUP_ENV_KEYS) {
    const value = originalEnv[key];
    if (value === undefined) {
      delete env[key];
    } else {
      env[key] = value;
    }
  }
});

describe("isCanonicalProductionAuthUrl", () => {
  it("accepts an https public origin and rejects localhost", () => {
    expect(isCanonicalProductionAuthUrl("https://jarvis.vercel.app")).toBe(true);
    expect(isCanonicalProductionAuthUrl("https://app.example.com")).toBe(true);
    expect(isCanonicalProductionAuthUrl("http://localhost:3000")).toBe(false);
    expect(isCanonicalProductionAuthUrl("https://localhost")).toBe(false);
    expect(isCanonicalProductionAuthUrl("http://example.com")).toBe(false);
    expect(isCanonicalProductionAuthUrl("not-a-url")).toBe(false);
    expect(isCanonicalProductionAuthUrl("")).toBe(false);
  });
});

describe("getSetupStatus", () => {
  it("starts incomplete on a fresh local clone", () => {
    const status = getSetupStatus();
    expect(status.owner).toBe(false);
    expect(status.authSecret).toBe(false);
    expect(status.authUrl).toBe(true);
    expect(status.aiGateway).toBe(false);
    expect(status.database).toBe(false);
    expect(status.blob).toBe(false);
    expect(status.hosted).toBe(false);
    expect(status.voice).toBe(false);
    expect(status.inbox).toBe(false);
    expect(status.canWriteLocalEnv).toBe(true);
    expect(isSetupScreenVisible(status)).toBe(true);
  });

  it("marks local computer steps when those values are set", () => {
    process.env.BETTER_AUTH_SECRET = "test-secret-value";
    process.env.AI_GATEWAY_API_KEY = "gw_test";
    const status = getSetupStatus();
    expect(status.authSecret).toBe(true);
    expect(status.aiGateway).toBe(true);
    expect(isSetupScreenVisible(status)).toBe(true);
  });

  it("treats a Vercel host as having AI Gateway via OIDC", () => {
    process.env.VERCEL = "1";
    const status = getSetupStatus();
    expect(status.hosted).toBe(true);
    expect(status.aiGateway).toBe(true);
    expect(status.authUrl).toBe(false);
    expect(status.canWriteLocalEnv).toBe(false);
  });

  it("completes the production auth URL on Vercel when BETTER_AUTH_URL is public https", () => {
    process.env.VERCEL = "1";
    process.env.BETTER_AUTH_URL = "https://jarvis.vercel.app";
    expect(getSetupStatus().authUrl).toBe(true);
  });

  it("hides the setup screen once OWNER_EMAIL is set", () => {
    process.env.OWNER_EMAIL = "you@example.com";
    const status = getSetupStatus();
    expect(status.owner).toBe(true);
    expect(isSetupScreenVisible(status)).toBe(false);
  });

  it("keeps the setup screen when OWNER_EMAIL is blank", () => {
    process.env.OWNER_EMAIL = "  ";
    expect(isSetupScreenVisible()).toBe(true);
  });
});

describe("visibleRequiredSetupSteps", () => {
  it("asks a local clone for .env.local values only", () => {
    expect(visibleRequiredSetupSteps({ hosted: false, authSecret: false })).toEqual([
      "authSecret",
      "aiGateway",
      "owner",
    ]);
    expect(visibleRequiredSetupSteps({ hosted: false, authSecret: true })).toEqual([
      "authSecret",
      "aiGateway",
      "owner",
    ]);
    expect(shouldShowRequiredSetupStep("database", { hosted: false, authSecret: true })).toBe(false);
    expect(shouldShowRequiredSetupStep("hosted", { hosted: false, authSecret: true })).toBe(false);
  });

  it("asks a Vercel deploy for project env, skipping local-only steps", () => {
    expect(visibleRequiredSetupSteps({ hosted: true, authSecret: true })).toEqual([
      "authUrl",
      "database",
      "blob",
      "owner",
    ]);
    expect(shouldShowRequiredSetupStep("aiGateway", { hosted: true, authSecret: true })).toBe(false);
    expect(shouldShowRequiredSetupStep("hosted", { hosted: true, authSecret: true })).toBe(false);
  });

  it("still shows the secret step on Vercel when BETTER_AUTH_SECRET is missing", () => {
    expect(visibleRequiredSetupSteps({ hosted: true, authSecret: false })).toEqual([
      "authSecret",
      "authUrl",
      "database",
      "blob",
      "owner",
    ]);
  });
});

describe("nextOpenRequiredSetupStep", () => {
  const incomplete = {
    authSecret: false,
    aiGateway: false,
    hosted: false,
    authUrl: false,
    database: false,
    blob: false,
    owner: false,
  } as const;

  it("opens AI Gateway after the secret on a local clone", () => {
    expect(nextOpenRequiredSetupStep({ ...incomplete, authSecret: true })).toBe("aiGateway");
  });

  it("opens the public URL after the secret on Vercel, not the owner step", () => {
    expect(
      nextOpenRequiredSetupStep({
        ...incomplete,
        hosted: true,
        authSecret: true,
        aiGateway: true,
      }),
    ).toBe("authUrl");
  });

  it("keeps hosted storage steps in order after the public URL", () => {
    expect(
      nextOpenRequiredSetupStep({
        ...incomplete,
        hosted: true,
        authSecret: true,
        aiGateway: true,
        authUrl: true,
      }),
    ).toBe("database");
    expect(
      nextOpenRequiredSetupStep({
        ...incomplete,
        hosted: true,
        authSecret: true,
        aiGateway: true,
        authUrl: true,
        database: true,
      }),
    ).toBe("blob");
  });
});

describe("canWriteLocalEnv", () => {
  it("is local-only", () => {
    const env = envStore();
    env.NODE_ENV = "development";
    delete env.VERCEL;
    expect(canWriteLocalEnv()).toBe(true);
    expect(isHostedOnVercel()).toBe(false);

    env.VERCEL = "1";
    expect(canWriteLocalEnv()).toBe(false);

    delete env.VERCEL;
    env.NODE_ENV = "production";
    expect(canWriteLocalEnv()).toBe(false);
  });
});
