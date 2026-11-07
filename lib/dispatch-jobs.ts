import { Client } from "eve/client";
import { hasNeon } from "@/lib/db";
import { appOrigin, internalDispatchSecret } from "@/lib/internal-auth";
import { findUserById } from "@/lib/email-users";
import { ownerAccount } from "@/lib/owner";
import { reminderContextForDispatch } from "@/lib/reminder-context";
import {
  isNudgeReminderSchedule,
  isReminderSchedule,
  parseSchedulePrompt,
  scheduleDispatchMessage,
  schedulePreviewText,
} from "@/lib/schedule-prompt";
import {
  advanceJobAfterRun,
  isOneOffJob,
  nextRunAtFromCadence,
  parseJobCadence,
} from "@/lib/job-cadence";
import {
  claimDueJobs,
  claimJob,
  completeJob,
  createChat,
  deleteJob,
  releaseJob,
  titleFromPrompt,
  updateChat,
} from "@/lib/store";
import type { ChatRecord, ScheduledJob } from "@/lib/types";

export const SCHEDULE_DISPATCH_USER_HEADER = "x-schedule-user-id";
export const SCHEDULE_DISPATCH_CHAT_HEADER = "x-schedule-chat-id";
export const SCHEDULE_DISPATCH_JOB_HEADER = "x-schedule-id";
export const SCHEDULE_DISPATCH_SECRET_HEADER = "x-schedule-dispatch-secret";
export const SCHEDULE_DISPATCH_REMINDER_HEADER = "x-schedule-reminder";

const DEFAULT_LEASE_MS = 5 * 60_000;
const RETRY_MS = 300_000;
/** A one-off that still fails this long after it was due is paused instead of retried. */
const ONE_OFF_GIVE_UP_MS = 6 * 60 * 60_000;

/**
 * What to do with a job whose dispatch failed before its session started.
 *
 * A recurring job used to keep its past-due `nextRunAt`, so every dispatcher
 * tick reclaimed it, failed again, and wrote two rows — waking the database
 * on every tick for as long as the error lasted. Now a recurring job skips to
 * its next slot (the error stays on the row for the Schedules page), and a
 * one-off retries on a short backoff, then pauses.
 */
export function failedDispatchPlan(
  job: Pick<ScheduledJob, "cadence" | "everyMinutes" | "nextRunAt" | "firstRunAt" | "lastError">,
  now = new Date(),
): { retryAt: Date | null; disable: boolean } {
  if (isOneOffJob(job)) {
    // Never give up on the first failure: the job may have just been
    // rescheduled. After that, measure from the slot it is scheduled for now.
    const dueAt = job.lastError ? oneOffScheduledAt(job) : Number.NaN;
    if (Number.isFinite(dueAt) && now.getTime() - dueAt > ONE_OFF_GIVE_UP_MS) {
      return { retryAt: null, disable: true };
    }
    return { retryAt: new Date(now.getTime() + RETRY_MS), disable: false };
  }
  const advanced = advanceJobAfterRun(job);
  if (!advanced.enabled || !advanced.nextRunAt) return { retryAt: null, disable: true };
  return { retryAt: new Date(advanced.nextRunAt), disable: false };
}

/**
 * When a one-off is scheduled to run. Editing its time rewrites its "once"
 * cadence (never `firstRunAt`), so use the later of the two.
 */
function oneOffScheduledAt(job: Pick<ScheduledJob, "cadence" | "firstRunAt">): number {
  const first = Date.parse(job.firstRunAt);
  const cadence = parseJobCadence(job.cadence);
  const at = cadence?.kind === "once" ? nextRunAtFromCadence(cadence)?.getTime() : undefined;
  return at !== undefined && Number.isFinite(at) ? Math.max(first, at) : first;
}

export type ScheduleStartSession = (
  job: ScheduledJob,
  chat: ChatRecord,
) => Promise<{ sessionId: string }>;

export { appOrigin } from "@/lib/internal-auth";

export function scheduleDispatchSecret(): string | null {
  return internalDispatchSecret();
}

export function scheduleSessionAuth(input: {
  userId: string;
  authenticator?: string;
  issuer?: string | null;
  email?: string | null;
  name?: string | null;
  chatId?: string | null;
  scheduleId?: string | null;
  reminder?: boolean;
}) {
  const attributes: Record<string, string> = { source: "schedule" };
  if (input.reminder) attributes.reminder = "1";
  if (input.email) attributes.email = input.email;
  if (input.name) attributes.name = input.name;
  if (input.chatId) attributes.chatId = input.chatId;
  if (input.scheduleId) attributes.scheduleId = input.scheduleId;
  return {
    authenticator: input.authenticator?.trim() || "better-auth",
    ...(input.issuer ? { issuer: input.issuer } : {}),
    principalId: input.userId,
    principalType: "user" as const,
    attributes,
  };
}

export async function buildScheduleDispatch(job: ScheduledJob, chat: ChatRecord) {
  const origin = appOrigin();
  const owner = await findUserById(job.userId);
  const context = isNudgeReminderSchedule(job.prompt)
    ? await reminderContextForDispatch({
        brief: parseSchedulePrompt(job.prompt).brief,
        excludeChatId: chat.id,
        origin,
        userId: job.userId,
      })
    : undefined;
  return {
    message: scheduleDispatchMessage(job, {
      chatId: chat.id,
      context,
      origin,
    }),
    auth: scheduleSessionAuth({
      userId: job.userId,
      authenticator: job.authenticator,
      issuer: job.issuer,
      email: owner?.email,
      name: owner?.name,
      chatId: chat.id,
      scheduleId: job.id,
      reminder: isReminderSchedule(job.prompt),
    }),
  };
}

function vercelProtectionBypassHeaders(): Record<string, string> {
  const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim();
  if (!bypass) return {};
  return { "x-vercel-protection-bypass": bypass };
}

export async function prepareScheduleChat(job: ScheduledJob): Promise<ChatRecord> {
  // One-off reminders email the user from this session. Later: push
  // notifications, and a dedicated reminders page separate from Schedules.
  return createChat(job.userId, titleFromPrompt(schedulePreviewText(job.prompt)), "schedule");
}

async function finishDispatchedJob(job: ScheduledJob): Promise<void> {
  const completed = await completeJob(job);
  if (completed) return;
  console.warn("[schedule] lost lease before complete", { jobId: job.id });
  if (isOneOffJob(job)) {
    const deleted = await deleteJob(job.userId, job.id);
    if (!deleted) {
      console.warn("[schedule] one-off still present after lost lease", { jobId: job.id });
    }
  }
}

export const NOT_OWNER_JOB_ERROR =
  "Paused: this schedule belongs to an account that can no longer sign in. Only the owner's schedules run.";
const NO_OWNER_YET_ERROR = "Waiting for the owner account (set OWNER_EMAIL), then this schedule runs.";
const NO_OWNER_RETRY_MS = 60 * 60_000;

export async function dispatchClaimedJobs(
  jobs: readonly ScheduledJob[],
  startSession: ScheduleStartSession,
): Promise<{ dispatched: number; failed: number; errors: string[] }> {
  let dispatched = 0;
  let failed = 0;
  const errors: string[] = [];
  // Jarvis is single-user: only the owner's schedules run. Jobs left behind by
  // other accounts (from a multi-user version) would otherwise keep spending
  // and mailing unattended after those accounts were locked out.
  const owner = await ownerAccount();
  await Promise.all(
    jobs.map(async (job) => {
      if (!owner || job.userId !== owner.id) {
        failed += 1;
        const message = owner ? NOT_OWNER_JOB_ERROR : NO_OWNER_YET_ERROR;
        errors.push(message);
        const retryAt = owner ? null : new Date(Date.now() + NO_OWNER_RETRY_MS);
        await releaseJob(job, message, retryAt, Boolean(owner));
        console.warn("[schedule] skipped job not owned by the owner", { jobId: job.id, ownerKnown: Boolean(owner) });
        return;
      }
      let started = false;
      try {
        const chat = await prepareScheduleChat(job);
        const session = await startSession(job, chat);
        started = true;
        if (session.sessionId) {
          await updateChat(job.userId, chat.id, { sessionId: session.sessionId });
        }
        await finishDispatchedJob(job);
        dispatched += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Schedule dispatch failed";
        if (started) {
          // The session already runs. Releasing the job would fire it (and any
          // reminder email) a second time, so only retry the bookkeeping.
          console.error("[schedule] post-start bookkeeping failed", { jobId: job.id, error: message });
          await finishDispatchedJob(job).catch((retryError) =>
            console.error("[schedule] could not complete dispatched job", {
              jobId: job.id,
              error: retryError instanceof Error ? retryError.message : retryError,
            }),
          );
          dispatched += 1;
          return;
        }
        failed += 1;
        errors.push(message);
        console.error("[schedule] dispatch failed", { jobId: job.id, error: message });
        const plan = failedDispatchPlan(job);
        const released = await releaseJob(job, message, plan.retryAt, plan.disable);
        if (!released) {
          console.warn("[schedule] lost lease before release", { jobId: job.id });
        }
      }
    }),
  );
  return { dispatched, failed, errors };
}

export async function dispatchDueJobs(
  startSession: ScheduleStartSession,
  options?: { now?: Date; limit?: number; leaseForMs?: number },
): Promise<{
  claimed: number;
  dispatched: number;
  failed: number;
  errors: string[];
  store: "neon" | "json";
}> {
  const now = options?.now ?? new Date();
  const jobs = await claimDueJobs({
    now,
    limit: options?.limit ?? 25,
    leaseForMs: options?.leaseForMs ?? DEFAULT_LEASE_MS,
  });
  const store = hasNeon() ? "neon" : "json";
  if (jobs.length === 0) {
    console.info("[schedule] claimed 0", { store });
    return { claimed: 0, dispatched: 0, failed: 0, errors: [], store };
  }
  console.info("[schedule] claimed", { store, count: jobs.length });
  const result = await dispatchClaimedJobs(jobs, startSession);
  return { claimed: jobs.length, ...result, store };
}

export async function dispatchJobNow(
  job: ScheduledJob,
  startSession: ScheduleStartSession,
  options?: { now?: Date; leaseForMs?: number },
): Promise<ScheduledJob> {
  const claimed = await claimJob(job.id, {
    now: options?.now ?? new Date(),
    leaseForMs: options?.leaseForMs ?? DEFAULT_LEASE_MS,
  });
  if (!claimed) {
    throw new Error(job.enabled ? "This schedule is already running." : "This schedule is paused.");
  }
  const result = await dispatchClaimedJobs([claimed], startSession);
  if (result.failed > 0) {
    throw new Error(result.errors[0] || "Unable to run this schedule.");
  }
  return claimed;
}

export function eveScheduleClient(job: ScheduledJob, chat: ChatRecord): Client {
  const secret = scheduleDispatchSecret();
  if (!secret) {
    throw new Error("A dispatch secret is not configured.");
  }
  return new Client({
    host: appOrigin(),
    headers: {
      [SCHEDULE_DISPATCH_SECRET_HEADER]: secret,
      [SCHEDULE_DISPATCH_USER_HEADER]: job.userId,
      [SCHEDULE_DISPATCH_CHAT_HEADER]: chat.id,
      [SCHEDULE_DISPATCH_JOB_HEADER]: job.id,
      ...(isReminderSchedule(job.prompt) ? { [SCHEDULE_DISPATCH_REMINDER_HEADER]: "1" } : {}),
      ...vercelProtectionBypassHeaders(),
    },
    redirect: "manual",
  });
}

export async function startScheduleSession(
  job: ScheduledJob,
  chat: ChatRecord,
): Promise<{ sessionId: string }> {
  const client = eveScheduleClient(job, chat);
  const { message } = await buildScheduleDispatch(job, chat);
  const { session } = await client.sessions.create({ message });
  return { sessionId: session.state.sessionId };
}
