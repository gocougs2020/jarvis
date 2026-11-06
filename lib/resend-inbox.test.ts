import { describe, expect, it } from "vitest";
import { inboundTokenFromInboxAddress, RESEND_ID_PATTERN, resendInboxAddress } from "./resend-inbox";

const MAILBOX = "agent@example.com";
const TOKEN = "abcde23456";

describe("Resend inbox addresses", () => {
  it("carry the user's secret token without a plus tag", () => {
    expect(resendInboxAddress(TOKEN, MAILBOX)).toBe("agent-abcde-23456@example.com");
    expect(resendInboxAddress(TOKEN, "Jarvis+old@example.com")).toBe("jarvis-abcde-23456@example.com");
  });

  it("map back to the token only on this app's mailbox", () => {
    expect(inboundTokenFromInboxAddress("Agent-ABCDE-23456@example.com", MAILBOX)).toBe(TOKEN);
    expect(inboundTokenFromInboxAddress("agent-abcde-23456@other.com", MAILBOX)).toBeNull();
    expect(inboundTokenFromInboxAddress("support-abcde-23456@example.com", MAILBOX)).toBeNull();
    expect(inboundTokenFromInboxAddress("agent-short@example.com", MAILBOX)).toBeNull();
  });

  it("needs a valid token and mailbox", () => {
    expect(resendInboxAddress("not-a-token", MAILBOX)).toBeNull();
    expect(resendInboxAddress(TOKEN, null)).toBeNull();
  });
});

describe("Resend ids", () => {
  it("reject path segments that could reach another inbox", () => {
    expect(RESEND_ID_PATTERN.test("b3e2b2b6-3f0e-4c8e-9ad3-2f43a1e2c7f1")).toBe(true);
    expect(RESEND_ID_PATTERN.test("../../other-inbox/threads/t1")).toBe(false);
    expect(RESEND_ID_PATTERN.test("t1/emails")).toBe(false);
  });
});
