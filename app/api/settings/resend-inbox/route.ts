import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/api";
import { inboundMailPayload } from "@/lib/inbound-mail-payload";
import {
  ensureAgentResendInbox,
  isOwnerUser,
  ResendInboxError,
  resendInboxAvailable,
} from "@/lib/resend-inbox";

/** Create the Resend inbox on the agent address. Resend bills past its free inboxes, so this is explicit. */
export async function POST(request: Request) {
  const { session, error } = await requireApiSession(request);
  if (error || !session) return error;
  if (!resendInboxAvailable()) {
    return NextResponse.json({ error: "Resend Inboxes are not available here." }, { status: 404 });
  }
  if (!(await isOwnerUser(session.user.id))) {
    return NextResponse.json(
      { error: "Only the owner can set up the agent inbox." },
      { status: 403 },
    );
  }
  try {
    await ensureAgentResendInbox();
  } catch (inboxError) {
    console.error("[resend-inbox] create failed", inboxError);
    const message =
      inboxError instanceof ResendInboxError
        ? `Resend could not create the inbox: ${inboxError.message}`
        : "Resend could not create the inbox.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
  return NextResponse.json({ inboundMail: await inboundMailPayload(session.user.id) });
}
