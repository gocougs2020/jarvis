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

vi.mock("@/lib/store", () => store);
vi.mock("@/lib/db", () => ({ hasNeon: () => false }));

const { dispatchClaimedJobs } = await import("@/lib/dispatch-jobs");

const job: ScheduledJob = {
  id: "job_1",
  userId: "user_1",
  prompt: "Run now. Do not ask questions.\n\nCall the dentist",
  firstRunAt: "2026-11-05T09:00:00.000Z",
  nextRunAt: "2026-11-05T09:00:00.000Z",
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
    expect(store.releaseJob).toHaveBeenCalledWith(job, "eve unavailable", expect.any(Date));
  });
});
