import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/api";
import { inboundMailPayload } from "@/lib/inbound-mail-payload";
import { ensureUserResendInbox, ResendInboxError, resendInboxAvailable } from "@/lib/resend-inbox";
import { ensureInboundMailToken } from "@/lib/store";

/** Turn on the signed-in user's Resend inbox. Resend bills inboxes, so this is explicit. */
export async function POST(request: Request) {
  const { session, error } = await requireApiSession(request);
  if (error || !session) return error;
  if (!resendInboxAvailable()) {
    return NextResponse.json({ error: "Resend Inboxes are not available here." }, { status: 404 });
  }
  const settings = await ensureInboundMailToken(session.user.id);
  try {
    await ensureUserResendInbox(session.user.id, session.user);
  } catch (inboxError) {
    console.error("[resend-inbox] create failed", inboxError);
    const message =
      inboxError instanceof ResendInboxError
        ? `Resend could not create the inbox: ${inboxError.message}`
        : "Resend could not create the inbox.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
  return NextResponse.json({
    inboundMail: await inboundMailPayload(session.user.id, settings.inboundMailToken),
  });
}
