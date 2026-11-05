import type { SessionContext } from "eve/context";
import { defineMemory, defineMemoryProvider } from "eve/memory";
import { byPrincipal } from "eve/memory/scope";
import {
  captureCompletedTurn,
  persistRelatedSessionCitations,
  promptNeedsRecall,
  recallRelatedSessions,
  resolveChatForEveSession,
} from "../../lib/session-memory";
import { lastMessageText } from "../lib/message-text";
import { requireUser } from "../lib/identity";

const sessionMemoryProvider = defineMemoryProvider({
  recall: {
    async "turn.started"(ctx) {
      return recallForTurn(ctx, lastMessageText(ctx.turn.input, "user"));
    },
    async "compaction.completed"(ctx) {
      return recallForTurn(ctx, lastMessageText(ctx.messages, "user"));
    },
  },
  capture: {
    async "turn.completed"(ctx) {
      try {
        const user = requireUser(ctx);
        const prompt = lastMessageText(ctx.turn.input, "user");
        const response = lastMessageText(ctx.messages, "assistant");
        if (!prompt && !response) return;
        await captureCompletedTurn({
          eveSessionId: ctx.session.id,
          prompt,
          response,
          turnId: ctx.turn.id,
          userId: user.userId,
          chatId: user.chatId,
        });
      } catch (error) {
        console.error("[session-memory] capture failed", error);
      }
    },
  },
});

async function recallForTurn(ctx: SessionContext, prompt: string) {
  try {
    const user = requireUser(ctx);
    if (!promptNeedsRecall(prompt)) return { messages: [] };
    // The chat lookup only matters for the vector search, so let it run while
    // the HyDE draft and embeddings are in flight instead of before them.
    const chat = resolveChatForEveSession(user.userId, ctx.session.id, user.chatId);
    const { citations, content } = await recallRelatedSessions(user.userId, prompt, {
      // Caught here so an early return in recall cannot leave it unhandled;
      // the citations chain below logs the error.
      excludeChatId: chat.then((row) => row?.id).catch(() => null),
      usageChatId: user.chatId,
    });
    // Citations are for the UI; do not hold the model back on this write.
    void chat
      .then((row) =>
        row
          ? persistRelatedSessionCitations({
              chatId: row.id,
              citations,
              prompt,
              userId: user.userId,
            })
          : undefined,
      )
      .catch((error) => console.error("[session-memory] citations persist failed", error));
    if (!content) return { messages: [] };
    return {
      messages: [{ id: "related-sessions", content }],
    };
  } catch (error) {
    console.error("[session-memory] recall failed", error);
    return { messages: [] };
  }
}

export default defineMemory({
  description:
    "Retrieve related prior prompts, answers, titles, and descriptions for this user.",
  provider: sessionMemoryProvider,
  scope: byPrincipal,
});
