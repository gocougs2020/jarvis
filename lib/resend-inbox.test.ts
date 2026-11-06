import { describe, expect, it } from "vitest";
import { RESEND_ID_PATTERN } from "./resend-inbox";
import { agentEmailAddress, isAgentRecipient } from "./resend";

describe("agent address", () => {
  it("comes from RESEND_FROM_EMAIL, display name and case removed", () => {
    process.env.RESEND_FROM_EMAIL = "Jarvis <Agent@Example.com>";
    expect(agentEmailAddress()).toBe("agent@example.com");
    expect(isAgentRecipient(["someone@else.test", "AGENT@example.com"])).toBe(true);
    expect(isAgentRecipient(["agent+tag@example.com"])).toBe(false);
  });

  it("is unset for the Resend sandbox sender", () => {
    process.env.RESEND_FROM_EMAIL = "onboarding@resend.dev";
    expect(agentEmailAddress()).toBeNull();
    delete process.env.RESEND_FROM_EMAIL;
    expect(agentEmailAddress()).toBeNull();
  });
});

describe("Resend ids", () => {
  it("reject path segments that could reach another inbox", () => {
    expect(RESEND_ID_PATTERN.test("b3e2b2b6-3f0e-4c8e-9ad3-2f43a1e2c7f1")).toBe(true);
    expect(RESEND_ID_PATTERN.test("../../other-inbox/threads/t1")).toBe(false);
    expect(RESEND_ID_PATTERN.test("t1/emails")).toBe(false);
  });
});
