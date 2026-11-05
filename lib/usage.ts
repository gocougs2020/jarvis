import type { LanguageModelUsage } from "ai";
import type { MessageStreamEvent } from "eve/client";
import { appConfig } from "@/app.config";
import {
  addUsageTokens,
  displayModelId,
  emptyUsageTokens,
  estimateUsageCost,
  EXA_SEARCH_USD_PER_REQUEST,
  type UsageTokens,
} from "@/lib/model-prices";
import type { UsagePurpose, UsageRecord } from "@/lib/types";

export const USAGE_PURPOSE_LABELS: Readonly<Record<UsagePurpose, string>> = {
  chat: "Chat",
  compaction: "Compaction",
  routing: "Model routing",
  session_title: "Session titles",
  session_memory: "Related memory",
  embeddings: "Embeddings",
  instructions: "Instructions",
  transcription: "Voice transcription",
  speech: "Voice replies",
  image: "Image generation",
  web_search: "Web search",
  email: "Email",
};

const MODEL_USAGE_PURPOSES = new Set<UsagePurpose>([
  "chat",
  "compaction",
  "routing",
  "session_title",
  "session_memory",
  "embeddings",
  "instructions",
  "transcription",
  "speech",
  "image",
  "email",
]);

export function isModelUsagePurpose(purpose: UsagePurpose): boolean {
  return MODEL_USAGE_PURPOSES.has(purpose);
}

export type UsageTotals = UsageTokens & {
  readonly costUsd: number;
  readonly calls: number;
};

export type UsageBreakdownRow = {
  readonly key: string;
  readonly label: string;
  readonly totals: UsageTotals;
  readonly turns?: number;
};

export type DailyUsageRow = {
  readonly date: string;
  readonly sessions: number;
  readonly turns: number;
  readonly modelCalls: number;
  readonly totals: UsageTotals;
};

export type UsageChatRef = {
  readonly id: string;
  readonly createdAt: string;
  readonly userId?: string;
};

export type UsageUserRef = {
  readonly id: string;
  readonly name: string;
  readonly email: string;
};

export type UsageUserRow = {
  readonly userId: string;
  readonly name: string;
  readonly email: string;
  readonly sessions: number;
  readonly turns: number;
  readonly totals: UsageTotals;
};

export function emptyUsageTotals(): UsageTotals {
  return { ...emptyUsageTokens(), costUsd: 0, calls: 0 };
}

export function addUsageTotals(left: UsageTotals, right: UsageTotals): UsageTotals {
  return {
    ...addUsageTokens(left, right),
    costUsd: left.costUsd + right.costUsd,
    calls: left.calls + right.calls,
  };
}

export function tokensFromUsageRecord(record: Pick<
  UsageRecord,
  | "inputTokens"
  | "outputTokens"
  | "reasoningTokens"
  | "cacheReadTokens"
  | "cacheWriteTokens"
>): UsageTokens {
  return {
    inputTokens: record.inputTokens,
    outputTokens: record.outputTokens,
    reasoningTokens: record.reasoningTokens,
    cacheReadTokens: record.cacheReadTokens,
    cacheWriteTokens: record.cacheWriteTokens,
  };
}

export function totalsFromUsageRecord(record: UsageRecord): UsageTotals {
  const tokens = tokensFromUsageRecord(record);
  const estimated = estimateUsageCost(record.modelId, tokens);
  return {
    ...tokens,
    costUsd: estimated > 0 ? estimated : record.costUsd,
    calls: 1,
  };
}

export function languageModelUsageFromTokens(tokens: UsageTokens): LanguageModelUsage {
  return {
    inputTokenDetails: {
      cacheReadTokens: tokens.cacheReadTokens || undefined,
      cacheWriteTokens: tokens.cacheWriteTokens || undefined,
      noCacheTokens: undefined,
    },
    inputTokens: tokens.inputTokens || undefined,
    outputTokenDetails: {
      reasoningTokens: tokens.reasoningTokens || undefined,
      textTokens: undefined,
    },
    outputTokens: tokens.outputTokens || undefined,
    totalTokens: (tokens.inputTokens + tokens.outputTokens) || undefined,
  };
}

export function tokensFromUnknownUsage(usage: unknown): UsageTokens {
  if (!usage || typeof usage !== "object") return emptyUsageTokens();
  const record = usage as Record<string, unknown>;
  if (typeof record.tokens === "number" && Number.isFinite(record.tokens)) {
    return { ...emptyUsageTokens(), inputTokens: Math.max(0, record.tokens) };
  }
  const inputDetails =
    record.inputTokenDetails && typeof record.inputTokenDetails === "object"
      ? (record.inputTokenDetails as Record<string, unknown>)
      : undefined;
  const outputDetails =
    record.outputTokenDetails && typeof record.outputTokenDetails === "object"
      ? (record.outputTokenDetails as Record<string, unknown>)
      : undefined;
  return {
    inputTokens: numberField(record.inputTokens),
    outputTokens: numberField(record.outputTokens),
    reasoningTokens: numberField(outputDetails?.reasoningTokens),
    cacheReadTokens: numberField(record.cacheReadTokens ?? inputDetails?.cacheReadTokens),
    cacheWriteTokens: numberField(record.cacheWriteTokens ?? inputDetails?.cacheWriteTokens),
  };
}

function numberField(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0;
}

export type StepUsage = UsageTokens & {
  readonly modelId: string;
  readonly purpose: "chat" | "compaction";
  readonly turnId: string;
  readonly stepIndex: number;
  readonly providerCostUsd?: number;
};

export function collectStepUsageFromEvents(events: readonly MessageStreamEvent[]): {
  readonly compactionCount: number;
  readonly lastChatModelId: string | undefined;
  readonly lastCompactionInputTokens: number | null;
  readonly lastStep: StepUsage | undefined;
  readonly steps: StepUsage[];
} {
  const fallbackModel = appConfig.models.compaction;
  const steps: StepUsage[] = [];
  let pendingModelId: string | undefined;
  let lastChatModelId: string | undefined;
  let compactionCount = 0;
  let lastCompactionInputTokens: number | null = null;
  let compacting = false;

  for (const event of events) {
    if (event.type === "step.started") {
      pendingModelId = event.data.modelId;
      if (!compacting) lastChatModelId = event.data.modelId;
    }
    if (event.type === "compaction.requested") {
      compacting = true;
      lastCompactionInputTokens = event.data.usageInputTokens;
    }
    if (event.type === "compaction.completed") {
      compactionCount += 1;
      compacting = false;
    }
    if (event.type !== "step.completed") continue;
    const tokens = tokensFromUnknownUsage(event.data.usage);
    if (tokens.inputTokens === 0 && tokens.outputTokens === 0) continue;
    const modelId = pendingModelId ?? lastChatModelId ?? fallbackModel;
    const purpose: "chat" | "compaction" = compacting ? "compaction" : "chat";
    const providerCost =
      event.data.usage &&
      typeof event.data.usage === "object" &&
      typeof event.data.usage.costUsd === "number"
        ? event.data.usage.costUsd
        : undefined;
    steps.push({
      ...tokens,
      modelId,
      purpose,
      turnId: event.data.turnId,
      stepIndex: event.data.stepIndex,
      providerCostUsd: providerCost,
    });
    if (purpose === "chat") lastChatModelId = modelId;
  }

  return {
    compactionCount,
    lastChatModelId,
    lastCompactionInputTokens,
    lastStep: steps.at(-1),
    steps,
  };
}

export function costForStep(step: StepUsage): number {
  const estimated = estimateUsageCost(step.modelId, step);
  if (estimated > 0) return estimated;
  if (
    typeof step.providerCostUsd === "number" &&
    Number.isFinite(step.providerCostUsd) &&
    step.providerCostUsd > 0
  ) {
    return step.providerCostUsd;
  }
  return 0;
}

export function totalsFromSteps(steps: readonly StepUsage[]): UsageTotals {
  return steps.reduce<UsageTotals>((totals, step) => {
    return addUsageTotals(totals, {
      ...step,
      costUsd: costForStep(step),
      calls: 1,
    });
  }, emptyUsageTotals());
}

export type WebSearchUsage = {
  readonly callId: string;
  readonly turnId: string;
  readonly stepIndex: number;
  readonly costUsd: number;
};

function isCompletedWebSearchResult(result: unknown): result is {
  readonly callId: string;
  readonly isError?: boolean;
  readonly kind: "tool-result";
  readonly toolName: "web_search";
} {
  if (!result || typeof result !== "object") return false;
  const record = result as Record<string, unknown>;
  return (
    record.kind === "tool-result" &&
    record.toolName === "web_search" &&
    typeof record.callId === "string" &&
    record.isError !== true
  );
}

export function collectWebSearchFromEvents(
  events: readonly MessageStreamEvent[],
): WebSearchUsage[] {
  const searches: WebSearchUsage[] = [];
  for (const event of events) {
    if (event.type !== "action.result") continue;
    if (event.data.status !== "completed") continue;
    if (!isCompletedWebSearchResult(event.data.result)) continue;
    searches.push({
      callId: event.data.result.callId,
      costUsd: EXA_SEARCH_USD_PER_REQUEST,
      stepIndex: event.data.stepIndex,
      turnId: event.data.turnId,
    });
  }
  return searches;
}

export function extrasTotals(records: readonly UsageRecord[]): UsageTotals {
  return records.reduce<UsageTotals>((totals, record) => {
    if (record.purpose === "chat" || record.purpose === "compaction") return totals;
    return addUsageTotals(totals, totalsFromUsageRecord(record));
  }, emptyUsageTotals());
}

export function usageDayKey(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

export function turnIdFromUsageRecord(record: Pick<UsageRecord, "id">): string | null {
  const step = record.id.match(/:step:([^:]+):\d+$/);
  if (step?.[1]) return step[1];
  const search = record.id.match(/:search:([^:]+):/);
  return search?.[1] ?? null;
}

function compareIsoAsc(left: string, right: string): number {
  return left.localeCompare(right);
}

export function summarizeUsageRecords(
  records: readonly UsageRecord[],
  options?: {
    readonly chats?: readonly UsageChatRef[];
    readonly users?: readonly UsageUserRef[];
  },
): {
  readonly byModel: UsageBreakdownRow[];
  readonly byPurpose: UsageBreakdownRow[];
  readonly byChat: UsageBreakdownRow[];
  readonly byDay: DailyUsageRow[];
  readonly byUser: UsageUserRow[];
  readonly modelCalls: number;
  readonly sessions: number;
  readonly turns: number;
  readonly totals: UsageTotals;
} {
  let totals = emptyUsageTotals();
  let modelCalls = 0;
  const models = new Map<string, UsageTotals>();
  const purposes = new Map<UsagePurpose, UsageTotals>();
  const chats = new Map<string, UsageTotals>();
  const chatTurns = new Map<string, Set<string>>();
  const users = new Map<string, UsageTotals>();
  const userTurns = new Map<string, Set<string>>();
  const userSessions = new Map<string, Set<string>>();
  const dayTotals = new Map<string, UsageTotals>();
  const dayModelCalls = new Map<string, number>();
  const sessionStartDay = new Map<string, string>();
  const turnStartDay = new Map<string, string>();

  for (const chat of options?.chats ?? []) {
    const day = usageDayKey(chat.createdAt);
    if (day) sessionStartDay.set(chat.id, day);
    if (chat.userId) {
      const sessions = userSessions.get(chat.userId) ?? new Set<string>();
      sessions.add(chat.id);
      userSessions.set(chat.userId, sessions);
    }
  }

  const chronological = [...records].sort((left, right) =>
    compareIsoAsc(left.createdAt, right.createdAt),
  );

  for (const record of chronological) {
    const row = totalsFromUsageRecord(record);
    const day = usageDayKey(record.createdAt);
    totals = addUsageTotals(totals, row);
    if (isModelUsagePurpose(record.purpose)) modelCalls += 1;
    models.set(record.modelId, addUsageTotals(models.get(record.modelId) ?? emptyUsageTotals(), row));
    purposes.set(
      record.purpose,
      addUsageTotals(purposes.get(record.purpose) ?? emptyUsageTotals(), row),
    );
    if (day) {
      dayTotals.set(day, addUsageTotals(dayTotals.get(day) ?? emptyUsageTotals(), row));
      if (isModelUsagePurpose(record.purpose)) {
        dayModelCalls.set(day, (dayModelCalls.get(day) ?? 0) + 1);
      }
    }
    users.set(record.userId, addUsageTotals(users.get(record.userId) ?? emptyUsageTotals(), row));
    if (record.chatId) {
      chats.set(record.chatId, addUsageTotals(chats.get(record.chatId) ?? emptyUsageTotals(), row));
      const owned = userSessions.get(record.userId) ?? new Set<string>();
      owned.add(record.chatId);
      userSessions.set(record.userId, owned);
      if (day && !sessionStartDay.has(record.chatId)) {
        sessionStartDay.set(record.chatId, day);
      }
      const turnId = turnIdFromUsageRecord(record);
      if (turnId) {
        const turns = chatTurns.get(record.chatId) ?? new Set<string>();
        turns.add(turnId);
        chatTurns.set(record.chatId, turns);
        const perUserTurns = userTurns.get(record.userId) ?? new Set<string>();
        perUserTurns.add(`${record.chatId}:${turnId}`);
        userTurns.set(record.userId, perUserTurns);
        const turnKey = `${record.chatId}:${turnId}`;
        if (day && !turnStartDay.has(turnKey)) {
          turnStartDay.set(turnKey, day);
        }
      }
    }
  }

  const sessionsByDay = new Map<string, number>();
  for (const day of sessionStartDay.values()) {
    sessionsByDay.set(day, (sessionsByDay.get(day) ?? 0) + 1);
  }
  const turnsByDay = new Map<string, number>();
  for (const day of turnStartDay.values()) {
    turnsByDay.set(day, (turnsByDay.get(day) ?? 0) + 1);
  }

  const dayKeys = new Set<string>([
    ...dayTotals.keys(),
    ...sessionsByDay.keys(),
    ...turnsByDay.keys(),
  ]);

  return {
    totals,
    modelCalls,
    sessions: sessionStartDay.size,
    turns: turnStartDay.size,
    byDay: [...dayKeys]
      .sort((left, right) => right.localeCompare(left))
      .map((date) => ({
        date,
        sessions: sessionsByDay.get(date) ?? 0,
        turns: turnsByDay.get(date) ?? 0,
        modelCalls: dayModelCalls.get(date) ?? 0,
        totals: dayTotals.get(date) ?? emptyUsageTotals(),
      })),
    byModel: [...models.entries()]
      .map(([key, value]) => ({ key, label: key, totals: value }))
      .sort((left, right) => right.totals.costUsd - left.totals.costUsd),
    byPurpose: [...purposes.entries()]
      .map(([key, value]) => ({
        key,
        label: USAGE_PURPOSE_LABELS[key],
        totals: value,
      }))
      .sort((left, right) => right.totals.costUsd - left.totals.costUsd),
    byChat: [...chats.entries()]
      .map(([key, value]) => ({
        key,
        label: key,
        totals: value,
        turns: chatTurns.get(key)?.size ?? 0,
      }))
      .sort((left, right) => right.totals.costUsd - left.totals.costUsd),
    byUser: (() => {
      const profiles = new Map((options?.users ?? []).map((user) => [user.id, user]));
      const ids = new Set<string>([...users.keys(), ...profiles.keys(), ...userSessions.keys()]);
      return [...ids]
        .map((userId) => {
          const profile = profiles.get(userId);
          return {
            userId,
            name: profile?.name.trim() || profile?.email || "Unknown user",
            email: profile?.email ?? "",
            sessions: userSessions.get(userId)?.size ?? 0,
            turns: userTurns.get(userId)?.size ?? 0,
            totals: users.get(userId) ?? emptyUsageTotals(),
          };
        })
        .sort((left, right) => right.totals.costUsd - left.totals.costUsd);
    })(),
  };
}

export function formatUsd(value: number): string {
  if (!Number.isFinite(value) || value === 0) return "$0.00";
  if (Math.abs(value) < 0.01) {
    return new Intl.NumberFormat("en-US", {
      currency: "USD",
      maximumFractionDigits: 4,
      minimumFractionDigits: 4,
      style: "currency",
    }).format(value);
  }
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    style: "currency",
  }).format(value);
}

export function formatTokenCount(value: number): string {
  return new Intl.NumberFormat("en-US", { notation: "compact" }).format(value);
}

export function formatCount(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

export type UsageSessionRow = {
  readonly chatId: string;
  readonly href: string;
  readonly title: string;
  readonly updatedAt: string;
  readonly turns: number;
  readonly totals: UsageTotals;
};

export type UsagePageSnapshot = {
  readonly totals: UsageTotals;
  readonly modelCalls: number;
  readonly sessions: number;
  readonly turns: number;
  readonly byDay: readonly DailyUsageRow[];
  readonly byModel: UsageBreakdownRow[];
  readonly byPurpose: UsageBreakdownRow[];
  readonly byUser: UsageUserRow[];
  readonly sessionsList: readonly UsageSessionRow[];
};

export function toUsagePageSnapshot(
  records: readonly UsageRecord[],
  chats: readonly {
    readonly id: string;
    readonly userId: string;
    readonly title: string;
    readonly createdAt: string;
    readonly updatedAt: string;
  }[],
  options?: {
    readonly users?: readonly UsageUserRef[];
    readonly includeSessions?: boolean;
  },
): UsagePageSnapshot {
  const summary = summarizeUsageRecords(records, {
    chats,
    users: options?.users,
  });
  const chatsById = new Map(chats.map((chat) => [chat.id, chat]));
  return {
    totals: summary.totals,
    modelCalls: summary.modelCalls,
    sessions: summary.sessions,
    turns: summary.turns,
    byDay: summary.byDay,
    byModel: summary.byModel.map((row) => ({
      ...row,
      label: displayModelId(row.key),
    })),
    byPurpose: summary.byPurpose,
    byUser: summary.byUser,
    sessionsList:
      options?.includeSessions === false
        ? []
        : summary.byChat.map((row) => {
            const chat = chatsById.get(row.key);
            return {
              chatId: row.key,
              href: `/s/${row.key}`,
              title: chat?.title || "Deleted session",
              updatedAt: chat?.updatedAt ?? "",
              turns: row.turns ?? 0,
              totals: row.totals,
            };
          }),
  };
}
