import { composeInboundMailAddress, inboundMailboxAddress } from "@/lib/inbound-mail-token";
import { getUserResendInbox, resendInboxAddress, resendInboxAvailable } from "@/lib/resend-inbox";

export type ResendInboxInfo = {
  /** The address the inbox has, or will have once turned on. */
  address: string | null;
  active: boolean;
  unread: number;
  error?: string;
};

export type InboundMailPayload = {
  address: string | null;
  configured: boolean;
  /** Null when Resend Inboxes are off or unavailable on this deployment. */
  resendInbox: ResendInboxInfo | null;
};

/** Settings view of the user's agent address and, when available, their Resend inbox. */
export async function inboundMailPayload(
  userId: string,
  token: string | null,
): Promise<InboundMailPayload> {
  const mailbox = inboundMailboxAddress();
  const base = {
    address: token ? composeInboundMailAddress(token, mailbox) : null,
    configured: Boolean(mailbox),
  };
  if (!resendInboxAvailable()) return { ...base, resendInbox: null };
  const address = token ? resendInboxAddress(token, mailbox) : null;
  try {
    const inbox = await getUserResendInbox(userId);
    return {
      ...base,
      resendInbox: { active: Boolean(inbox), address: inbox?.address ?? address, unread: inbox?.unread ?? 0 },
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
