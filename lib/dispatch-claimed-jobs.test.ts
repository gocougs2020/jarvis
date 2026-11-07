import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatRecord, ScheduledJob } from "@/lib/types";

const store = vi.hoisted(() => ({
  createChat: vi.fn(),
  updateChat: vi.fn(),
  completeJob: vi.fn(),
  deleteJob: vi.fn(),
  releaseJob: vi.fn(),
  claimDueJobs: vi.fn(),
  claimJob: vi.fn(),
  titleFromPrompt: (value: string) => value,
}));

const owner = vi.hoisted(() => ({ ownerAccount: vi.fn() }));

vi.mock("@/lib/store", () => store);
vi.mock("@/lib/db", () => ({ hasNeon: () => false }));
vi.mock("@/lib/owner", () => owner);

const { dispatchClaimedJobs } = await import("@/lib/dispatch-jobs");

const dueAt = new Date(Date.now() - 60_000).toISOString();

const job: ScheduledJob = {
  id: "job_1",
  userId: "user_1",
  prompt: "Run now. Do not ask questions.\n\nCall the dentist",
  firstRunAt: dueAt,
  nextRunAt: dueAt,
  everyMinutes: null,
  cadence: null,
  enabled: true,
  leaseToken: "lease",
  leaseUntil: null,
  lastError: null,
  authenticator: "better-auth",
  issuer: null,
  visibility: "private",
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  store.createChat.mockResolvedValue({ id: "chat_1" } as ChatRecord);
  store.completeJob.mockResolvedValue(true);
  owner.ownerAccount.mockResolvedValue({ id: "user_1", email: "ada@example.com", name: "Ada" });
});

describe("dispatchClaimedJobs for one owner", () => {
  it("pauses a schedule left behind by another account instead of running it", async () => {
    const startSession = vi.fn();
    const result = await dispatchClaimedJobs([{ ...job, userId: "user_old" }], startSession);
    expect(startSession).not.toHaveBeenCalled();
    expect(result).toMatchObject({ dispatched: 0, failed: 1 });
    expect(store.releaseJob).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user_old" }),
      expect.stringMatching(/can no longer sign in/),
      null,
      true,
    );
  });

  it("holds every schedule, without pausing it, until the owner account exists", async () => {
    owner.ownerAccount.mockResolvedValue(null);
    const startSession = vi.fn();
    await dispatchClaimedJobs([job], startSession);
    expect(startSession).not.toHaveBeenCalled();
    expect(store.releaseJob).toHaveBeenCalledWith(job, expect.stringMatching(/OWNER_EMAIL/), expect.any(Date), false);
  });
});

describe("dispatchClaimedJobs", () => {
  it("does not release a job whose session already started", async () => {
    store.updateChat.mockRejectedValueOnce(new Error("db blip"));
    const result = await dispatchClaimedJobs([job], async () => ({ sessionId: "wrun_1" }));
    expect(result).toMatchObject({ dispatched: 1, failed: 0 });
    expect(store.releaseJob).not.toHaveBeenCalled();
    expect(store.completeJob).toHaveBeenCalled();
  });

  it("releases a one-off job for retry when the session never started", async () => {
    const result = await dispatchClaimedJobs([job], async () => {
      throw new Error("eve unavailable");
    });
    expect(result).toMatchObject({ dispatched: 0, failed: 1 });
    expect(store.releaseJob).toHaveBeenCalledWith(job, "eve unavailable", expect.any(Date), false);
  });

  it("skips a failing recurring job to its next slot instead of retrying every tick", async () => {
    const daily = {
      ...job,
      everyMinutes: 1440,
      cadence: { kind: "daily" as const, hour: 8, minute: 0, timezone: "America/Denver" },
    };
    await dispatchClaimedJobs([daily], async () => {
      throw new Error("eve unavailable");
    });
    const retryAt = store.releaseJob.mock.calls[0]?.[2] as Date;
    expect(retryAt.getTime()).toBeGreaterThan(Date.now());
    expect(store.releaseJob.mock.calls[0]?.[3]).toBe(false);
  });
});
