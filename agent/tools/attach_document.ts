import { defineTool } from "eve/tools";
import { z } from "zod";
import { chatSessionId, requireUser } from "../lib/identity";
import { attachDocument, getChatByEveSessionId } from "../../lib/store";
import { getUserDocument, toClientDocument } from "../../lib/documents";

export default defineTool({
  description:
    "Attach an existing file to the current chat session so it appears in the session canvas.",
  inputSchema: z.object({
    id: z.string().min(1),
    chatId: z.string().optional().describe("App chat id. Defaults to the current session."),
  }),
  async execute(input, ctx) {
    const user = requireUser(ctx);
    const document = await getUserDocument(user.userId, input.id);
    const chatId =
      input.chatId ?? (await getChatByEveSessionId(user.userId, chatSessionId(ctx)))?.id;
    if (!chatId) {
      throw new Error("No chat session is linked yet. Ask the user to send another message, then attach again.");
    }
    const attached = await attachDocument(user.userId, document.id, chatId);
    if (!attached) {
      throw new Error("Unable to attach that file to this session.");
    }
    return { attached: true, document: toClientDocument(document, []), chatId };
  },
});
