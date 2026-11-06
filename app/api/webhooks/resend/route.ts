import { NextResponse } from "next/server";
import { ReceivedEmailContentError } from "@/lib/email-content";
import { processInboundResendEmail, processInboxEmailReceived } from "@/lib/email-inbox";
import { recordSentMessageId } from "@/lib/email-send";
import { getResend, resendConfigured } from "@/lib/resend";

export const runtime = "nodejs";

function headerValue(request: Request, name: string): string {
  return request.headers.get(name) ?? request.headers.get(name.toLowerCase()) ?? "";
}

export async function POST(request: Request) {
  if (!resendConfigured() || !process.env.RESEND_WEBHOOK_SECRET) {
    return new NextResponse("Not configured", { status: 503 });
  }

  const payload = await request.text();
  try {
    const event = getResend().webhooks.verify({
      payload,
      headers: {
        id: headerValue(request, "svix-id"),
        timestamp: headerValue(request, "svix-timestamp"),
        signature: headerValue(request, "svix-signature"),
      },
      webhookSecret: process.env.RESEND_WEBHOOK_SECRET,
    });

    if (event.type === "email.received") {
      await processInboundResendEmail({
        emailId: event.data.email_id,
        from: event.data.from,
        to: event.data.to,
        cc: event.data.cc,
        receivedFor: event.data.received_for,
        subject: event.data.subject,
        attachments: event.data.attachments,
      });
    } else if (event.type === "inbox.email.received") {
      // Resend Inboxes (resendInbox in app.config.ts): store the mail and,
      // when the owner wrote it, start a session.
      await processInboxEmailReceived({
        inboxId: event.data.inbox_id,
        threadId: event.data.thread_id,
        emailId: event.data.email_id,
        direction: event.data.email?.direction,
      });
    } else if (event.type === "email.sent" || event.type === "email.delivered") {
      // Optional events: the Message-ID of agent mail, so a reply to it
      // continues the session that sent it.
      await recordSentMessageId(event.data.email_id, event.data.message_id);
    }

    return new NextResponse("OK", { status: 200 });
  } catch (error) {
    console.error("[email] webhook failed", error);
    if (error instanceof ReceivedEmailContentError && !error.retryable) {
      return new NextResponse("OK", { status: 200 });
    }
    return new NextResponse("Error", { status: 400 });
  }
}
