import { normalizeEmailAddress } from "@/lib/email-users";

export type OutboundSender = {
  /** RFC 5322 From header, e.g. `Ada via Jarvis <agent@example.com>`. */
  from: string;
  /** Where replies go when the mail leaves the owner's own inbox. */
  replyTo?: string;
  /** True when the From carries the owner's secret plus-address. */
  usesPrivateAddress: boolean;
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
 * Pick the From for agent mail.
 *
 * The per-user plus-address (`agent+k7xqm-2n4pw@…`) is the secret that lets
 * mail start an unattended session, so it only appears on mail to the
 * account owner. Mail to anyone else comes from the shared workspace mailbox,
 * named for the owner, with replies routed to the owner's real inbox.
 */
export function chooseOutboundSender(input: {
  appName: string;
  ownerEmail: string | null | undefined;
  ownerName?: string | null;
  recipients: readonly string[];
  privateAddress: string | null;
  workspaceAddress: string | null;
}): OutboundSender {
  const owner = input.ownerEmail ? normalizeEmailAddress(input.ownerEmail) : "";
  const onlyOwner =
    Boolean(owner) &&
    input.recipients.length > 0 &&
    input.recipients.every((recipient) => normalizeEmailAddress(recipient) === owner);
  const app = displayName(input.appName) || "Agent";

  if (onlyOwner && input.privateAddress) {
    return { from: `${app} <${input.privateAddress}>`, usesPrivateAddress: true };
  }

  const workspace = input.workspaceAddress ? normalizeEmailAddress(input.workspaceAddress) : "";
  if (!workspace) {
    throw new Error(
      "Set RESEND_FROM_EMAIL to a verified mailbox so the agent can email people other than you.",
    );
  }
  const person = displayName(input.ownerName ?? "");
  return {
    from: `${person ? `${person} via ${app}` : app} <${workspace}>`,
    ...(owner ? { replyTo: owner } : {}),
    usesPrivateAddress: false,
  };
}
