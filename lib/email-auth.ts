import { normalizeEmailAddress } from "@/lib/email-users";

/**
 * The agent address is not secret, and From is easy to forge, so an email
 * may only start an unattended session when the receiving server reports
 * that it passed DMARC for the From domain.
 *
 * Only the topmost `Authentication-Results` header counts: the receiving
 * server prepends it, above anything the sender wrote, and a sender can add
 * its own forged "dmarc=pass" lower down. Callers must pass the header
 * values in message order from the raw message, never a name → value map,
 * which can keep the forged copy.
 *
 * Fails closed: no header, a failing or missing DMARC verdict, or a verdict
 * without `header.from` equal to the From domain means "not verified".
 */
export function senderPassesDmarc(
  authenticationResults: readonly string[] | null | undefined,
  fromAddress: string,
): boolean {
  const from = normalizeEmailAddress(fromAddress);
  const at = from.lastIndexOf("@");
  const domain = at > 0 ? from.slice(at + 1) : "";
  const topmost = authenticationResults?.[0]?.toLowerCase();
  if (!domain || !topmost) return false;

  const verdicts = [...topmost.matchAll(/\bdmarc=([a-z]+)([^;]*)/g)];
  if (verdicts.length === 0) return false;
  return verdicts.every(([, result, rest]) => {
    const headerFrom = rest?.match(/header\.from=([^\s;)]+)/)?.[1]?.replace(/^@/, "");
    return result === "pass" && headerFrom === domain;
  });
}

/** `Authentication-Results` values in message order (topmost first) from parsed raw headers. */
export function authenticationResultsInOrder(
  headers: readonly { readonly key: string; readonly value: string }[],
): string[] {
  return headers
    .filter((header) => header.key.trim().toLowerCase() === "authentication-results")
    .map((header) => header.value);
}
