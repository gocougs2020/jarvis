import { describe, expect, it } from "vitest";
import { isSelfSendTarget, sendEmailNeedsApproval } from "./identity";

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

  it("requires approval outside reminder runs", () => {
    expect(sendEmailNeedsApproval({ source: "schedule" }, {})).toBe(true);
    expect(sendEmailNeedsApproval({ source: "email" }, {})).toBe(true);
    expect(sendEmailNeedsApproval(undefined, {})).toBe(true);
  });
});
