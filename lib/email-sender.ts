import { normalizeEmailAddress } from "@/lib/email-users";

export type OutboundSender = {
  /** RFC 5322 From header, e.g. `Ada via Jarvis <agent@example.com>`. */
  from: string;
  /** Where replies go when the mail is not just to the account owner. */
  replyTo?: string;
};

function displayName(value: string): string {
  // Letters, digits, spaces and a little punctuation: always a valid unquoted
  // RFC 5322 phrase, so a profile name cannot add or break headers.
  return value
    .replace(/[^\p{L}\p{N} .'_-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 64);
}

/**
 * Pick the From for agent mail. Everything goes out from the agent address
 * (`RESEND_FROM_EMAIL`). Mail to the owner comes from the agent by name;
 * mail to anyone else is "Owner via Agent" with replies routed to the owner.
 */
export function chooseOutboundSender(input: {
  appName: string;
  ownerEmail: string | null | undefined;
  ownerName?: string | null;
  recipients: readonly string[];
  agentAddress: string | null;
}): OutboundSender {
  const agent = input.agentAddress ? normalizeEmailAddress(input.agentAddress) : "";
  if (!agent) {
    throw new Error("Set RESEND_FROM_EMAIL to the agent's verified address (for example agent@yourdomain.com).");
  }
  const owner = input.ownerEmail ? normalizeEmailAddress(input.ownerEmail) : "";
  const onlyOwner =
    Boolean(owner) &&
    input.recipients.length > 0 &&
    input.recipients.every((recipient) => normalizeEmailAddress(recipient) === owner);
  const app = displayName(input.appName) || "Agent";

  if (onlyOwner) return { from: `${app} <${agent}>` };

  const person = displayName(input.ownerName ?? "");
  return {
    from: `${person ? `${person} via ${app}` : app} <${agent}>`,
    ...(owner ? { replyTo: owner } : {}),
  };
}
