import { describe, expect, it } from "vitest";
import { chooseOutboundSender } from "./email-sender";

const base = {
  appName: "Jarvis",
  ownerEmail: "Ada@Example.com",
  ownerName: "Ada Lovelace",
  privateAddress: "agent+k7xqm-2n4pw@mail.example.com",
  workspaceAddress: "Jarvis <agent@mail.example.com>",
};

describe("chooseOutboundSender", () => {
  it("uses the private plus-address only for mail to the owner", () => {
    const sender = chooseOutboundSender({ ...base, recipients: ["ada@example.com"] });
    expect(sender.from).toBe("Jarvis <agent+k7xqm-2n4pw@mail.example.com>");
    expect(sender.usesPrivateAddress).toBe(true);
  });

  it("never exposes the plus-address to other recipients", () => {
    const sender = chooseOutboundSender({
      ...base,
      recipients: ["ada@example.com", "bob@partner.test"],
    });
    expect(sender.from).toBe("Ada Lovelace via Jarvis <agent@mail.example.com>");
    expect(sender.from).not.toContain("k7xqm");
    expect(sender.replyTo).toBe("ada@example.com");
    expect(sender.usesPrivateAddress).toBe(false);
  });

  it("strips header-breaking characters from the display name", () => {
    const sender = chooseOutboundSender({
      ...base,
      ownerName: 'Eve "<x@y>"\r\nBcc: z@z',
      recipients: ["bob@partner.test"],
    });
    expect(sender.from).toBe("Eve x y Bcc z z via Jarvis <agent@mail.example.com>");
  });

  it("refuses third-party mail without a workspace mailbox", () => {
    expect(() =>
      chooseOutboundSender({ ...base, workspaceAddress: null, recipients: ["bob@partner.test"] }),
    ).toThrow(/RESEND_FROM_EMAIL/);
  });
});
