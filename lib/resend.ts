import { Resend } from "resend";
import { APP_NAME } from "@/lib/brand";
import { normalizeEmailAddress } from "@/lib/email-users";

let client: Resend | null = null;

export function resendConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

export function getResend(): Resend {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error("RESEND_API_KEY is not set.");
  }
  client ??= new Resend(apiKey);
  return client;
}

export function resendFromAddress(): string {
  const configured = process.env.RESEND_FROM_EMAIL?.trim();
  if (!configured) return `${APP_NAME} <onboarding@resend.dev>`;
  if (configured.includes("<")) return configured;
  return `${APP_NAME} <${configured}>`;
}

/**
 * The agent's one email address: it sends from it, receives at it, and hosts
 * the Resend inbox on it. Set by `RESEND_FROM_EMAIL` (for example
 * `Jarvis <agent@yourdomain.com>`). Null until that is a real domain address.
 */
export function agentEmailAddress(): string | null {
  const address = normalizeEmailAddress(process.env.RESEND_FROM_EMAIL ?? "");
  if (!address.includes("@") || address.endsWith("@resend.dev")) return null;
  return address;
}

/** True when any of these addresses is the agent's own. */
export function isAgentRecipient(addresses: readonly string[]): boolean {
  const agent = agentEmailAddress();
  return Boolean(agent) && addresses.some((address) => normalizeEmailAddress(address) === agent);
}
