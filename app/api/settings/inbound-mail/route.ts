import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/api";
import { inboundMailPayload } from "@/lib/inbound-mail-payload";
import { ensureUserResendInbox, getUserResendInbox } from "@/lib/resend-inbox";
import { rotateInboundMailToken } from "@/lib/store";

export async function POST(request: Request) {
  const { session, error } = await requireApiSession(request);
  if (error || !session) return error;
  // A Resend inbox lives at a token address, so a rotation moves it to a new
  // inbox. The old one stops reaching the agent (its token no longer maps to
  // this account) but keeps its threads in Resend until it is deleted there.
  const hadResendInbox = await getUserResendInbox(session.user.id).catch(() => null);
  const settings = await rotateInboundMailToken(session.user.id);
  if (hadResendInbox) {
    await ensureUserResendInbox(session.user.id, session.user).catch((inboxError: unknown) =>
      console.error("[resend-inbox] re-create after rotation failed", inboxError),
    );
  }
  return NextResponse.json({
    inboundMail: await inboundMailPayload(session.user.id, settings.inboundMailToken),
  });
}
