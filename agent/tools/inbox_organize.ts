import { defineTool } from "eve/tools";
import { z } from "zod";
import { requireUser } from "../lib/identity";
import {
  MOVABLE_INBOX_FOLDERS,
  organizeInboxThread,
  requireAgentResendInbox,
  RESEND_ID_PATTERN,
} from "../../lib/resend-inbox";

export default defineTool({
  description:
    "Organize a thread in the agent's Resend inbox: move it (archive, inbox, spam, trash), mark it read or unread, and add or remove labels by name. A label that does not exist yet is created. Use it to keep the inbox triaged, e.g. archive handled threads or swap Needs reply for Done after replying.",
  inputSchema: z.object({
    threadId: z.string().regex(RESEND_ID_PATTERN),
    folder: z.enum(MOVABLE_INBOX_FOLDERS).optional(),
    read: z.boolean().optional(),
    addLabels: z.array(z.string().min(1).max(64)).max(10).optional(),
    removeLabels: z.array(z.string().min(1).max(64)).max(10).optional(),
  }),
  async execute(input, ctx) {
    const user = requireUser(ctx);
    const inbox = await requireAgentResendInbox(user.userId);
    return organizeInboxThread({ inboxId: inbox.id, ...input });
  },
});
