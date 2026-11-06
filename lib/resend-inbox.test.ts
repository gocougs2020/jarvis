import { describe, expect, it } from "vitest";
import { inboundTokenFromInboxAddress, resendInboxAddress } from "./resend-inbox";

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
