import { defineAgent, defineDynamic } from "eve";
import { modelContextWindowTokens } from "../lib/token-budget";
import { COMPACTION_MODEL, compactionModel, resolveSessionModelSelection } from "./lib/models";

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
    // Wrapped so summaries run at `models.reasoning.compaction`. Pass the window
    // explicitly rather than rely on eve resolving it for a model object.
    model: compactionModel(),
    modelContextWindowTokens: modelContextWindowTokens(COMPACTION_MODEL),
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
