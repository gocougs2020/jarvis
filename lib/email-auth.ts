import { normalizeEmailAddress } from "@/lib/email-users";

/**
 * The agent address is not secret, and From is easy to forge, so an email
 * may only start an unattended session when the receiving server reports
 * that it passed DMARC for the From domain. Resend's receiving API returns
 * the message headers; `Authentication-Results` carries the verdict.
 *
 * Fails closed: no header, any failing DMARC verdict, or a verdict for
 * another domain means "not verified". A sender can add its own
 * Authentication-Results header, so one forged "pass" next to the real
 * "fail" still fails.
 */
export function senderPassesDmarc(
  headers: Readonly<Record<string, string | readonly string[]>> | null | undefined,
  fromAddress: string,
): boolean {
  const from = normalizeEmailAddress(fromAddress);
  const domain = from.slice(from.lastIndexOf("@") + 1);
  if (!headers || !domain || !from.includes("@")) return false;

  const values = Object.entries(headers)
    .filter(([name]) => name.trim().toLowerCase() === "authentication-results")
    .flatMap(([, value]) => (Array.isArray(value) ? value : [value]))
    .join("\n")
    .toLowerCase();
  const verdicts = [...values.matchAll(/\bdmarc=([a-z]+)([^;\n]*)/g)];
  if (verdicts.length === 0) return false;
  return verdicts.every(([, result, rest]) => {
    if (result !== "pass") return false;
    const headerFrom = rest?.match(/header\.from=([^\s;)]+)/)?.[1];
    return !headerFrom || headerFrom.replace(/^@/, "") === domain;
  });
}
