import { agentEmailAddress } from "@/lib/resend";
import { getAgentResendInbox, isOwnerUser, resendInboxAvailable } from "@/lib/resend-inbox";

export type ResendInboxInfo = {
  /** The agent address the inbox lives (or will live) on. */
  address: string | null;
  active: boolean;
  unread: number;
  error?: string;
};

export type InboundMailPayload = {
  /** The agent's address (`RESEND_FROM_EMAIL`), or null until it is set to a real domain. */
  address: string | null;
  configured: boolean;
  /** Null when Resend Inboxes are off or unavailable, or the viewer is not the owner. */
  resendInbox: ResendInboxInfo | null;
};

/** Settings view of the agent address and, for the owner, its Resend inbox. */
export async function inboundMailPayload(userId: string): Promise<InboundMailPayload> {
  const address = agentEmailAddress();
  const base = { address, configured: Boolean(address) };
  if (!resendInboxAvailable() || !(await isOwnerUser(userId))) {
    return { ...base, resendInbox: null };
  }
  try {
    const inbox = await getAgentResendInbox();
    return {
      ...base,
      resendInbox: { active: Boolean(inbox), address, unread: inbox?.unread ?? 0 },
    };
  } catch (error) {
    console.error("[resend-inbox] status lookup failed", error);
    return {
      ...base,
      resendInbox: {
        active: false,
        address,
        unread: 0,
        error: "Could not reach Resend to check the inbox.",
      },
    };
  }
}
