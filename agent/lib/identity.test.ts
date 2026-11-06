import { describe, expect, it } from "vitest";
import { chatSessionId, isChildSession, isSelfSendTarget, sendEmailNeedsApproval } from "./identity";

describe("isSelfSendTarget", () => {
  it("treats omitted and me-aliases as self", () => {
    expect(isSelfSendTarget(undefined)).toBe(true);
    expect(isSelfSendTarget("")).toBe(true);
    expect(isSelfSendTarget("me")).toBe(true);
    expect(isSelfSendTarget("my email")).toBe(true);
  });

  it("treats a named address as someone else", () => {
    expect(isSelfSendTarget("ada@example.com")).toBe(false);
  });
});

describe("sendEmailNeedsApproval", () => {
  const reminder = { source: "schedule", reminder: "1" };

  it("skips approval only for a reminder run to the signed-in user", () => {
    expect(sendEmailNeedsApproval(reminder, { subject: "s", body: "b" })).toBe(false);
    expect(sendEmailNeedsApproval(reminder, { to: "me", subject: "s", body: "b" })).toBe(false);
    expect(
      sendEmailNeedsApproval(reminder, { subject: "s", body: "b", documentIds: ["doc_1"] }),
    ).toBe(false);
  });

  it("requires approval when a reminder adds anyone else", () => {
    expect(sendEmailNeedsApproval(reminder, { to: "x@evil.test", subject: "s" })).toBe(true);
    expect(sendEmailNeedsApproval(reminder, { cc: "x@evil.test", subject: "s" })).toBe(true);
    expect(sendEmailNeedsApproval(reminder, { to: ["x@evil.test"], subject: "s" })).toBe(true);
  });

  it("sends to the signed-in user without approval from any session", () => {
    expect(sendEmailNeedsApproval({ source: "schedule" }, {})).toBe(false);
    expect(sendEmailNeedsApproval({ source: "email" }, { to: "me" })).toBe(false);
    expect(sendEmailNeedsApproval(undefined, { subject: "Brief", body: "b" })).toBe(false);
    expect(
      sendEmailNeedsApproval({ email: "Ada@Example.com" }, { to: "ada@example.com", subject: "s" }),
    ).toBe(false);
  });

  it("requires approval for anyone else, from any session", () => {
    expect(sendEmailNeedsApproval(undefined, { to: "x@evil.test" })).toBe(true);
    expect(sendEmailNeedsApproval({ email: "ada@example.com" }, { to: "x@evil.test" })).toBe(true);
    expect(sendEmailNeedsApproval({ source: "email" }, { cc: "x@evil.test" })).toBe(true);
    expect(
      sendEmailNeedsApproval({ email: "ada@example.com" }, { to: "ada@example.com, x@evil.test" }),
    ).toBe(true);
  });

  it("asks for self-sends too when the config says so, except on reminder runs", () => {
    const strict = { selfEmailRequiresApproval: true };
    expect(sendEmailNeedsApproval(undefined, {}, strict)).toBe(true);
    expect(sendEmailNeedsApproval({ source: "schedule" }, {}, strict)).toBe(true);
    expect(sendEmailNeedsApproval(reminder, {}, strict)).toBe(false);
    expect(sendEmailNeedsApproval(reminder, { to: "x@evil.test" }, strict)).toBe(true);
  });
});

describe("chatSessionId", () => {
  it("resolves a delegated child to its root session", () => {
    expect(chatSessionId({ session: { id: "child", parent: { rootSessionId: "root" } } })).toBe(
      "root",
    );
    expect(isChildSession({ session: { id: "child", parent: { rootSessionId: "root" } } })).toBe(
      true,
    );
  });

  it("keeps a root session as it is", () => {
    expect(chatSessionId({ session: { id: "root" } })).toBe("root");
    expect(isChildSession({ session: { id: "root" } })).toBe(false);
  });
});
