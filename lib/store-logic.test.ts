import { describe, expect, it } from "vitest";
import type { EmbeddingRecord, ScheduledJob } from "@/lib/types";
import {
  applyChatPatch,
  applyJobPatch,
  applySettingsPatch,
  releasedJobFields,
  chatEventId,
  completeJobMutation,
  defaultSettings,
  holdsJobLease,
  embeddingMatchesSearch,
  isJobClaimable,
  isManualJobClaimable,
  jobCadenceUpdate,
  newChatRecord,
  newJobRecord,
  rankEmbeddingHits,
  sameEmbeddingKey,
  titleFromPrompt,
} from "@/lib/store-logic";

const daily = { kind: "daily" as const, timezone: "UTC", hour: 9, minute: 0 };

function job(overrides: Partial<ScheduledJob> = {}): ScheduledJob {
  return {
    ...newJobRecord(
      "user-1",
      {
        prompt: "brief",
        firstRunAt: "2026-09-06T10:00:00.000Z",
        everyMinutes: null,
        authenticator: "better-auth",
        issuer: null,
        cadence: { kind: "once", timezone: "UTC", at: "2026-09-06T10:00" },
      },
      "2026-09-06T09:00:00.000Z",
      "job-1",
    ),
    ...overrides,
  };
}

describe("titleFromPrompt", () => {
  it("uses a skill title for a bare slash invoke", () => {
    expect(titleFromPrompt("/remind")).toBe("Remind");
  });

  it("truncates long prompts and falls back when empty", () => {
    expect(titleFromPrompt("   ")).toBe("New session");
    expect(titleFromPrompt("a".repeat(60))).toBe(`${"a".repeat(53)}…`);
  });
});

describe("defaultSettings", () => {
  it("starts on auto with an empty overlay", () => {
    expect(defaultSettings("user-1")).toEqual({
      userId: "user-1",
      modelTier: "auto",
      instructionOverlay: "",
    });
  });

  it("keeps modelTier when an overlay-only patch omits it", () => {
    const current = {
      userId: "user-1",
      modelTier: "high" as const,
      instructionOverlay: "Be brief",
    };
    expect(
      applySettingsPatch(current, { modelTier: undefined, instructionOverlay: "Shorter" }),
    ).toEqual({
      ...current,
      instructionOverlay: "Shorter",
    });
  });
});

describe("chat records", () => {
  it("creates a web chat with empty description and no session", () => {
    const chat = newChatRecord("user-1", "Hello", undefined, "2026-09-06T10:00:00.000Z", "chat-1");
    expect(chat).toMatchObject({
      id: "chat-1",
      userId: "user-1",
      title: "Hello",
      description: "",
      source: "web",
      sessionId: null,
      streamIndex: 0,
    });
  });

  it("only bumps updatedAt when touchUpdatedAt is set", () => {
    const chat = newChatRecord("user-1", "Hello", "web", "2026-09-06T10:00:00.000Z", "chat-1");
    expect(applyChatPatch(chat, { title: "Hi" }, "2026-09-06T11:00:00.000Z").updatedAt).toBe(
      chat.updatedAt,
    );
    expect(
      applyChatPatch(chat, { title: "Hi", touchUpdatedAt: true }, "2026-09-06T11:00:00.000Z")
        .updatedAt,
    ).toBe("2026-09-06T11:00:00.000Z");
  });

  it("uses a deterministic chat event id", () => {
    expect(chatEventId("chat-1", 3)).toBe("chat-1:3");
  });
});

describe("job records", () => {
  it("ignores requested visibility and copies firstRunAt onto nextRunAt", () => {
    const created = newJobRecord(
      "user-1",
      {
        prompt: "nudge",
        firstRunAt: "2026-09-07T15:00:00.000Z",
        everyMinutes: null,
        authenticator: "better-auth",
        issuer: null,
        visibility: "shared",
      },
      "2026-09-06T10:00:00.000Z",
      "job-1",
    );
    expect(created.visibility).toBe("private");
    expect(created.nextRunAt).toBe(created.firstRunAt);
    expect(created.enabled).toBe(true);
    expect(created.leaseToken).toBeNull();
  });

  it("clears cadence when only everyMinutes changes", () => {
    expect(jobCadenceUpdate({ everyMinutes: 30 })).toBeNull();
    expect(jobCadenceUpdate({ cadence: daily })).toEqual(daily);
    expect(jobCadenceUpdate({})).toBeUndefined();
  });

  it("applies a cadence patch without dropping other fields", () => {
    const next = applyJobPatch(job(), { cadence: daily, prompt: "later" }, "2026-09-06T12:00:00.000Z");
    expect(next.cadence).toEqual(daily);
    expect(next.prompt).toBe("later");
    expect(next.updatedAt).toBe("2026-09-06T12:00:00.000Z");
  });

  it("claims due jobs whose lease has expired", () => {
    const now = "2026-09-06T10:00:00.000Z";
    expect(isJobClaimable(job({ nextRunAt: now, leaseUntil: null }), now)).toBe(true);
    expect(isJobClaimable(job({ enabled: false, nextRunAt: now }), now)).toBe(false);
    expect(isJobClaimable(job({ nextRunAt: "2026-09-06T11:00:00.000Z" }), now)).toBe(false);
    expect(isJobClaimable(job({ nextRunAt: now, leaseUntil: "2026-09-06T10:01:00.000Z" }), now)).toBe(
      false,
    );
    expect(isJobClaimable(job({ nextRunAt: now, leaseUntil: now }), now)).toBe(true);
  });

  it("lets Run now claim a future job that is not leased", () => {
    const now = "2026-09-06T10:00:00.000Z";
    expect(
      isManualJobClaimable(job({ nextRunAt: "2026-09-08T10:00:00.000Z", leaseUntil: null }), now),
    ).toBe(true);
    expect(
      isManualJobClaimable(
        job({ nextRunAt: "2026-09-08T10:00:00.000Z", leaseUntil: "2026-09-06T10:01:00.000Z" }),
        now,
      ),
    ).toBe(false);
  });

  it("only lets the worker that holds the lease complete or release", () => {
    const claimed = job({ leaseToken: "lease-a" });
    expect(holdsJobLease(claimed, claimed)).toBe(true);
    expect(holdsJobLease({ leaseToken: "lease-b" }, claimed)).toBe(false);
    expect(holdsJobLease(claimed, { leaseToken: null })).toBe(false);
  });

  it("retries one-offs without moving a repeating job's next run", () => {
    expect(releasedJobFields("boom", "2026-09-06T10:05:00.000Z", "2026-09-06T10:00:00.000Z")).toEqual({
      leaseToken: null,
      leaseUntil: null,
      lastError: "boom",
      nextRunAt: "2026-09-06T10:05:00.000Z",
      updatedAt: "2026-09-06T10:00:00.000Z",
    });
    expect(releasedJobFields("boom", null, "2026-09-06T10:00:00.000Z")).toEqual({
      leaseToken: null,
      leaseUntil: null,
      lastError: "boom",
      updatedAt: "2026-09-06T10:00:00.000Z",
    });
  });

  it("deletes one-off jobs and advances repeating ones", () => {
    expect(completeJobMutation(job()).action).toBe("delete");
    const repeating = job({ cadence: daily, everyMinutes: null });
    const result = completeJobMutation(repeating);
    expect(result.action).toBe("advance");
    if (result.action === "advance") {
      expect(result.leaseToken).toBeNull();
      expect(result.lastError).toBeNull();
      expect(result.nextRunAt).toBeTruthy();
    }
  });
});

describe("embedding search", () => {
  const record = (id: string, overrides: Partial<EmbeddingRecord> = {}): EmbeddingRecord => ({
    id,
    userId: "user-1",
    kind: "session_title",
    sourceType: "session",
    sourceId: id,
    turnId: null,
    text: "hello",
    embedding: [1, 0],
    createdAt: "2026-09-06T10:00:00.000Z",
    updatedAt: "2026-09-06T10:00:00.000Z",
    ...overrides,
  });

  it("matches embeddings by user, kind, source, and turn", () => {
    const left = record("a", { turnId: null });
    expect(sameEmbeddingKey(left, { ...left, turnId: undefined })).toBe(true);
    expect(sameEmbeddingKey(left, { ...left, kind: "session_prompt" })).toBe(false);
  });

  it("scopes user search to the owner plus includeSourceIds", () => {
    const input = {
      userId: "user-1",
      queryEmbeddings: [[1, 0]],
      limit: 5,
      includeSourceIds: ["shared-1"],
    };
    expect(embeddingMatchesSearch(record("own"), input)).toBe(true);
    expect(embeddingMatchesSearch(record("other", { userId: "user-2" }), input)).toBe(false);
    expect(
      embeddingMatchesSearch(record("shared-1", { userId: "user-2", sourceId: "shared-1" }), input),
    ).toBe(true);
    expect(
      embeddingMatchesSearch(record("own", { kind: "document_title" }), {
        ...input,
        kinds: ["session_title"],
      }),
    ).toBe(false);
    expect(
      embeddingMatchesSearch(record("own"), { ...input, excludeSourceIds: ["own"] }),
    ).toBe(false);
  });

  it("keeps the highest score per id and applies the floor", () => {
    const a = record("a");
    const ranked = rankEmbeddingHits(
      [
        { record: a, score: 0.4 },
        { record: a, score: 0.9 },
        { record: record("b"), score: 0.2 },
      ],
      { minScore: 0.5, limit: 8 },
    );
    expect(ranked.map((hit) => [hit.record.id, hit.score])).toEqual([["a", 0.9]]);
  });
});
