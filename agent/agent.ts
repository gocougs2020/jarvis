import { defineAgent, defineDynamic } from "eve";
import { COMPACTION_MODEL, resolveSessionModelSelection } from "./lib/models";

function attributionFrom(ctx: {
  readonly session: {
    readonly id: string;
    readonly auth: {
      readonly current?: {
        principalId?: string | null;
        principalType?: string | null;
        attributes?: Record<string, unknown> | null;
      } | null;
    };
  };
}) {
  const auth = ctx.session.auth.current;
  return {
    eveSessionId: ctx.session.id,
    userId:
      auth?.principalType === "user" && auth.principalId ? auth.principalId : undefined,
    chatId: typeof auth?.attributes?.chatId === "string" ? auth.attributes.chatId : undefined,
  };
}

export default defineAgent({
  compaction: {
    // Window is already min(256k, 90% of model capacity); compact when that cap is reached.
    // Keep this a model id string: eve reloads a model object from this file's
    // top-level `model`, which is dynamic here, so compaction would fail. eve
    // has no compaction reasoning setting for a dynamic agent, so summaries run
    // at the provider's default effort.
    model: COMPACTION_MODEL,
    thresholdPercent: 1,
  },
  build: {
    externalDependencies: [
      "better-sqlite3",
      "better-auth",
      "@neondatabase/serverless",
      "@vercel/blob",
      "resend",
    ],
  },
  model: defineDynamic({
    events: {
      // Assess the first prompt once, then lock the model so later turns hit the prompt cache.
      "session.started": async (_event, ctx) =>
        resolveSessionModelSelection(ctx.messages, attributionFrom(ctx)),
      "turn.started": async (_event, ctx) =>
        resolveSessionModelSelection(ctx.messages, attributionFrom(ctx)),
    },
  }),
});
