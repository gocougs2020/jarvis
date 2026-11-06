import { describe, expect, it } from "vitest";
import { chooseOutboundSender } from "./email-sender";

const base = {
  appName: "Jarvis",
  ownerEmail: "Ada@Example.com",
  ownerName: "Ada Lovelace",
  agentAddress: "Jarvis <agent@mail.example.com>",
};

describe("chooseOutboundSender", () => {
  it("sends mail to the owner from the agent by name", () => {
    const sender = chooseOutboundSender({ ...base, recipients: ["ada@example.com"] });
    expect(sender.from).toBe("Jarvis <agent@mail.example.com>");
    expect(sender.replyTo).toBeUndefined();
  });

  it("sends other mail on the owner's behalf with replies to the owner", () => {
    const sender = chooseOutboundSender({
      ...base,
      recipients: ["ada@example.com", "bob@partner.test"],
    });
    expect(sender.from).toBe("Ada Lovelace via Jarvis <agent@mail.example.com>");
    expect(sender.replyTo).toBe("ada@example.com");
  });

  it("strips header-breaking characters from the display name", () => {
    const sender = chooseOutboundSender({
      ...base,
      ownerName: 'Eve "<x@y>"\r\nBcc: z@z',
      recipients: ["bob@partner.test"],
    });
    expect(sender.from).toBe("Eve x y Bcc z z via Jarvis <agent@mail.example.com>");
  });

  it("refuses to send without an agent address", () => {
    expect(() =>
      chooseOutboundSender({ ...base, agentAddress: null, recipients: ["bob@partner.test"] }),
    ).toThrow(/RESEND_FROM_EMAIL/);
  });
});
