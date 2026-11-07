import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUserByEmail: vi.fn(),
  oldestUser: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ ensureNeonAuthSchema: vi.fn(async () => undefined) }));
vi.mock("@/lib/email-users", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/email-users")>();
  return { ...actual, findUserByEmail: mocks.findUserByEmail, oldestUser: mocks.oldestUser };
});

import {
  ACCESS_DENIED_MESSAGE,
  canCreateAccount,
  configuredOwnerEmail,
  inboundMailOwner,
  isOwnerEmail,
  isOwnerEmailFor,
  OWNER_NOT_CONFIGURED_MESSAGE,
  ownerAccount,
  resetOwnerCache,
  SIGNUP_CLOSED_MESSAGE,
  SIGNUP_NOT_ALLOWED_MESSAGE,
  signupDecision,
} from "@/lib/owner";

const owner = { id: "user-1", email: "ada@example.com", name: "Ada" };
const colleague = { id: "user-0", email: "sam@example.com", name: "Sam" };

function env(): Record<string, string | undefined> {
  return process.env as Record<string, string | undefined>;
}

afterEach(() => {
  delete env().OWNER_EMAIL;
  delete env().VERCEL;
  resetOwnerCache();
  vi.clearAllMocks();
});

describe("configuredOwnerEmail", () => {
  it("normalizes OWNER_EMAIL and treats blank as unset", () => {
    expect(configuredOwnerEmail({ OWNER_EMAIL: "  Ada <ADA@Example.com> " })).toBe("ada@example.com");
    expect(configuredOwnerEmail({ OWNER_EMAIL: " " })).toBeNull();
    expect(configuredOwnerEmail({})).toBeNull();
  });
});

describe("signupDecision", () => {
  it("with OWNER_EMAIL, allows only that address", () => {
    const rules = { ownerEmail: "ada@example.com", ownerRequired: true, accountExists: true };
    expect(signupDecision("ADA@example.com", rules)).toEqual({ ok: true });
    expect(signupDecision("sam@example.com", rules)).toEqual({ ok: false, message: SIGNUP_NOT_ALLOWED_MESSAGE });
  });

  it("on Vercel without OWNER_EMAIL, allows nobody", () => {
    const rules = { ownerEmail: null, ownerRequired: true, accountExists: false };
    expect(signupDecision("ada@example.com", rules)).toEqual({ ok: false, message: OWNER_NOT_CONFIGURED_MESSAGE });
  });

  it("locally without OWNER_EMAIL, the first sign-up claims it and then sign-up closes", () => {
    const rules = { ownerEmail: null, ownerRequired: false };
    expect(signupDecision("ada@example.com", { ...rules, accountExists: false })).toEqual({ ok: true });
    expect(signupDecision("sam@example.com", { ...rules, accountExists: true })).toEqual({
      ok: false,
      message: SIGNUP_CLOSED_MESSAGE,
    });
  });
});

describe("isOwnerEmailFor", () => {
  it("with OWNER_EMAIL, only that address may sign in, whatever account is oldest", () => {
    const rules = { ownerEmail: "ada@example.com", ownerRequired: true, oldestEmail: "sam@example.com" };
    expect(isOwnerEmailFor("ada@example.com", rules)).toBe(true);
    expect(isOwnerEmailFor("sam@example.com", rules)).toBe(false);
  });

  it("on Vercel without OWNER_EMAIL, nobody may sign in", () => {
    expect(isOwnerEmailFor("ada@example.com", { ownerEmail: null, ownerRequired: true, oldestEmail: "ada@example.com" })).toBe(false);
  });

  it("locally without OWNER_EMAIL, only the first account may sign in", () => {
    const rules = { ownerEmail: null, ownerRequired: false, oldestEmail: "ada@example.com" };
    expect(isOwnerEmailFor("Ada@Example.com", rules)).toBe(true);
    expect(isOwnerEmailFor("sam@example.com", rules)).toBe(false);
    expect(isOwnerEmailFor("ada@example.com", { ...rules, oldestEmail: null })).toBe(false);
    expect(isOwnerEmailFor("", rules)).toBe(false);
  });
});

describe("owner lookups", () => {
  it("finds the owner by OWNER_EMAIL, not by age, so an older colleague account is locked out", async () => {
    env().OWNER_EMAIL = "ada@example.com";
    env().VERCEL = "1";
    mocks.findUserByEmail.mockResolvedValue(owner);
    mocks.oldestUser.mockResolvedValue(colleague);

    await expect(ownerAccount()).resolves.toEqual(owner);
    await expect(isOwnerEmail("sam@example.com")).resolves.toBe(false);
    await expect(isOwnerEmail("ada@example.com")).resolves.toBe(true);
    await expect(canCreateAccount("sam@example.com")).resolves.toEqual({
      ok: false,
      message: SIGNUP_NOT_ALLOWED_MESSAGE,
    });
    expect(mocks.oldestUser).not.toHaveBeenCalled();
  });

  it("has no owner on Vercel until OWNER_EMAIL is set", async () => {
    env().VERCEL = "1";
    mocks.oldestUser.mockResolvedValue(owner);
    await expect(ownerAccount()).resolves.toBeNull();
    await expect(isOwnerEmail("ada@example.com")).resolves.toBe(false);
  });

  it("locally uses the first account and closes sign-up once it exists", async () => {
    mocks.oldestUser.mockResolvedValueOnce(null);
    await expect(canCreateAccount("ada@example.com")).resolves.toEqual({ ok: true });

    mocks.oldestUser.mockResolvedValue(owner);
    await expect(canCreateAccount("sam@example.com")).resolves.toEqual({ ok: false, message: SIGNUP_CLOSED_MESSAGE });
    await expect(isOwnerEmail("ada@example.com")).resolves.toBe(true);
  });
});

describe("inboundMailOwner", () => {
  it("files every message for the owner and flags only the owner's own address", async () => {
    env().OWNER_EMAIL = "ada@example.com";
    mocks.findUserByEmail.mockResolvedValue(owner);
    await expect(inboundMailOwner("Ada <ada@example.com>")).resolves.toEqual({ user: owner, fromAccount: true });
    await expect(inboundMailOwner("sam@example.com")).resolves.toEqual({ user: owner, fromAccount: false });
  });

  it("ignores mail until the owner account exists", async () => {
    env().OWNER_EMAIL = "ada@example.com";
    mocks.findUserByEmail.mockResolvedValue(null);
    await expect(inboundMailOwner("ada@example.com")).resolves.toBeNull();
  });
});

it("keeps a clear message for a locked-out account", () => {
  expect(ACCESS_DENIED_MESSAGE).toMatch(/can't sign in/);
});
