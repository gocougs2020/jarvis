import { describe, expect, it } from "vitest";
import { authenticationResultsInOrder, senderPassesDmarc } from "./email-auth";

const pass =
  "amazonses.com; spf=pass smtp.mailfrom=ada@example.com; dkim=pass header.i=@example.com; dmarc=pass header.from=example.com;";
const fail = "amazonses.com; dmarc=fail (p=reject) header.from=example.com";

describe("senderPassesDmarc", () => {
  it("accepts a DMARC pass for the From domain in the topmost header", () => {
    expect(senderPassesDmarc([pass], "Ada <ada@example.com>")).toBe(true);
  });

  it("fails closed without a verdict", () => {
    expect(senderPassesDmarc(null, "ada@example.com")).toBe(false);
    expect(senderPassesDmarc([], "ada@example.com")).toBe(false);
    expect(senderPassesDmarc(["mx; spf=pass"], "ada@example.com")).toBe(false);
    expect(senderPassesDmarc(["mx; dmarc=pass"], "ada@example.com")).toBe(false);
  });

  it("trusts only the topmost header, so a forged pass below a real fail fails", () => {
    expect(senderPassesDmarc([fail, pass], "ada@example.com")).toBe(false);
  });

  it("rejects a pass for some other domain", () => {
    expect(senderPassesDmarc(["mx; dmarc=pass header.from=attacker.test"], "ada@example.com")).toBe(false);
  });

  it("keeps header order when collecting values", () => {
    const headers = [
      { key: "authentication-results", value: fail },
      { key: "subject", value: "hi" },
      { key: "Authentication-Results", value: pass },
    ];
    expect(authenticationResultsInOrder(headers)).toEqual([fail, pass]);
  });
});
