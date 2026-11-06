import { defineTool } from "eve/tools";
import { z } from "zod";
import { requireUser } from "../lib/identity";
import { parseAddressList } from "../../lib/email-users";
import {
  draftInboxReply,
  latestInboundEmailId,
  replyInInboxThread,
  requireUserResendInbox,
  sendInboxDraft,
  RESEND_ID_PATTERN,
} from "../../lib/resend-inbox";

const inputSchema = z.object({
  threadId: z.string().regex(RESEND_ID_PATTERN),
  mode: z
    .enum(["draft", "send", "send_draft"])
    .describe(
      "draft: save a reply draft in the thread for the user to review (no approval). send: send a reply now. send_draft: send the reply an existing draft holds, by draftId (for example one Resend's inbox agent wrote). Pass its final text: that text goes out as a normal reply to the message the draft answers (the draft's own recipients are ignored), then the draft is discarded.",
    ),
  text: z
    .string()
    .optional()
    .describe("Plain-text reply body. Required for every mode; for send_draft, the draft's final text."),
  html: z.string().optional().describe("Optional HTML body. Defaults to the text."),
  emailId: z
    .string()
    .regex(RESEND_ID_PATTERN)
    .optional()
    .describe("Message to reply to. Defaults to the latest inbound message in the thread."),
  replyAll: z.boolean().optional(),
  cc: z.string().optional().describe("Extra CC addresses, comma-separated (send only)."),
  draftId: z.string().regex(RESEND_ID_PATTERN).optional().describe("Draft to send (send_draft only)."),
});

export default defineTool({
  description:
    "Reply inside a thread of the user's Resend inbox, from their agent address, so the conversation stays threaded. Prefer mode draft unless the user asked you to send. Sending (send or send_draft) always needs the user's approval. For a brand-new email with no thread, use send_email.",
  approval: ({ toolInput }) =>
    (toolInput as { mode?: string } | undefined)?.mode === "draft" ? "not-applicable" : "user-approval",
  inputSchema,
  async execute(input, ctx) {
    const user = requireUser(ctx);
    const inbox = await requireUserResendInbox(user.userId);
    const idempotencyKey = `inbox-reply/${ctx.callId}`;

    const text = input.text?.trim();
    if (!text) throw new Error("text is required: the reply body, or the draft's final text.");

    if (input.mode === "send_draft") {
      if (!input.draftId) throw new Error("draftId is required to send a draft.");
      const sentId = await sendInboxDraft({
        draftId: input.draftId,
        html: input.html,
        idempotencyKey,
        inboxId: inbox.id,
        replyAll: input.replyAll,
        text,
        threadId: input.threadId,
      });
      return { sent: true, emailId: sentId, threadId: input.threadId };
    }
    const emailId = input.emailId ?? (await latestInboundEmailId(inbox.id, input.threadId));
    if (!emailId) throw new Error("This thread has no message to reply to.");

    if (input.mode === "draft") {
      const draftId = await draftInboxReply({
        emailId,
        html: input.html,
        idempotencyKey,
        inboxId: inbox.id,
        text,
        threadId: input.threadId,
      });
      return {
        drafted: true,
        draftId,
        threadId: input.threadId,
        nextStep: "Show the user the draft. Send it with mode send_draft only after they approve.",
      };
    }

    const sentId = await replyInInboxThread({
      cc: input.cc ? parseAddressList(input.cc) : undefined,
      emailId,
      html: input.html,
      idempotencyKey,
      inboxId: inbox.id,
      replyAll: input.replyAll,
      text,
      threadId: input.threadId,
    });
    return { sent: true, emailId: sentId, threadId: input.threadId };
  },
});
