import { describe, expect, it } from "vitest";
import { senderPassesDmarc } from "./email-auth";

const pass = "amazonses.com; spf=pass smtp.mailfrom=ada@example.com; dkim=pass header.i=@example.com; dmarc=pass header.from=example.com;";

describe("senderPassesDmarc", () => {
  it("accepts a DMARC pass for the From domain", () => {
    expect(senderPassesDmarc({ "Authentication-Results": pass }, "Ada <ada@example.com>")).toBe(true);
    expect(senderPassesDmarc({ "authentication-results": [pass] }, "ada@example.com")).toBe(true);
  });

  it("fails closed without a verdict", () => {
    expect(senderPassesDmarc(null, "ada@example.com")).toBe(false);
    expect(senderPassesDmarc({ subject: "hi" }, "ada@example.com")).toBe(false);
    expect(senderPassesDmarc({ "Authentication-Results": "mx; spf=pass" }, "ada@example.com")).toBe(false);
  });

  it("rejects a failure, even next to a forged pass", () => {
    const fail = "amazonses.com; dmarc=fail (p=reject) header.from=example.com";
    expect(senderPassesDmarc({ "Authentication-Results": fail }, "ada@example.com")).toBe(false);
    expect(senderPassesDmarc({ "Authentication-Results": [pass, fail] }, "ada@example.com")).toBe(false);
  });

  it("rejects a pass for some other domain", () => {
    const other = "mx; dmarc=pass header.from=attacker.test";
    expect(senderPassesDmarc({ "Authentication-Results": other }, "ada@example.com")).toBe(false);
  });
});
