import { afterEach, describe, expect, it } from "vitest";
import {
  appOrigin,
  failedDispatchPlan,
  scheduleDispatchSecret,
  scheduleSessionAuth,
} from "@/lib/dispatch-jobs";
import { normalizeChatSource } from "@/lib/types";

const KEYS = [
  "EMAIL_SESSION_SECRET",
  "RESEND_WEBHOOK_SECRET",
  "BETTER_AUTH_SECRET",
  "BETTER_AUTH_URL",
  "VERCEL_PROJECT_PRODUCTION_URL",
  "VERCEL_URL",
] as const;

const original: Partial<Record<(typeof KEYS)[number], string | undefined>> = {};

function env() {
  return process.env as Record<string, string | undefined>;
}

afterEach(() => {
  const store = env();
  for (const key of KEYS) {
    if (original[key] === undefined) delete store[key];
    else store[key] = original[key];
  }
});

for (const key of KEYS) {
  original[key] = process.env[key];
}

describe("scheduleDispatchSecret", () => {
  it("prefers EMAIL_SESSION_SECRET", () => {
    env().EMAIL_SESSION_SECRET = "email";
    env().BETTER_AUTH_SECRET = "auth";
    expect(scheduleDispatchSecret()).toBe("email");
  });

  it("derives from BETTER_AUTH_SECRET instead of sending it raw", () => {
    delete env().EMAIL_SESSION_SECRET;
    env().RESEND_WEBHOOK_SECRET = "whsec_visible_in_resend";
    env().BETTER_AUTH_SECRET = "auth";
    const secret = scheduleDispatchSecret();
    expect(secret).toMatch(/^[0-9a-f]{64}$/);
    expect(secret).not.toBe("auth");
    expect(secret).not.toBe("whsec_visible_in_resend");
  });
});

describe("appOrigin", () => {
  it("uses BETTER_AUTH_URL when set", () => {
    env().BETTER_AUTH_URL = "https://app.example.com/";
    expect(appOrigin()).toBe("https://app.example.com");
  });

  it("falls back to the Vercel production host", () => {
    delete env().BETTER_AUTH_URL;
    env().VERCEL_PROJECT_PRODUCTION_URL = "app.vercel.app";
    env().VERCEL_URL = "preview.vercel.app";
    expect(appOrigin()).toBe("https://app.vercel.app");
  });
});

describe("normalizeChatSource", () => {
  it("keeps schedule sessions labeled as schedule", () => {
    expect(normalizeChatSource("schedule")).toBe("schedule");
  });
});

describe("scheduleSessionAuth", () => {
  it("marks reminder runs and keeps chat identity", () => {
    expect(
      scheduleSessionAuth({
        userId: "user-1",
        email: "ada@example.com",
        chatId: "chat-1",
        scheduleId: "job-1",
        reminder: true,
      }),
    ).toEqual({
      authenticator: "better-auth",
      principalId: "user-1",
      principalType: "user",
      attributes: {
        source: "schedule",
        reminder: "1",
        email: "ada@example.com",
        chatId: "chat-1",
        scheduleId: "job-1",
      },
    });
  });
});

describe("failedDispatchPlan", () => {
  const now = new Date("2026-11-05T15:00:00.000Z");
  const base = {
    everyMinutes: null,
    firstRunAt: "2026-11-05T14:55:00.000Z",
    nextRunAt: "2026-11-05T14:55:00.000Z",
  };

  it("moves a failing recurring job to its next slot instead of retrying every tick", () => {
    const plan = failedDispatchPlan(
      {
        ...base,
        everyMinutes: 1440,
        cadence: { kind: "daily", hour: 8, minute: 0, timezone: "America/Denver" },
      },
      now,
    );
    expect(plan.disable).toBe(false);
    expect(plan.retryAt && plan.retryAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("retries a fresh one-off soon, then pauses it", () => {
    const fresh = failedDispatchPlan({ ...base, cadence: null }, now);
    expect(fresh).toEqual({ retryAt: new Date(now.getTime() + 300_000), disable: false });
    const stale = failedDispatchPlan(
      { ...base, cadence: null, firstRunAt: "2026-11-04T00:00:00.000Z" },
      now,
    );
    expect(stale).toEqual({ retryAt: null, disable: true });
  });
});
