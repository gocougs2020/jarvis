import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/api";
import { parseJobCadence, scheduleFieldsFromCadence } from "@/lib/job-cadence";
import { normalizeSchedulePrompt } from "@/lib/schedule-prompt";
import { createJob, deleteJob, listJobs, updateJob } from "@/lib/store";
import {
  cadenceFiresMoreThanOncePerDay,
  resolveHostSchedulePlan,
  SUB_DAILY_SCHEDULE_MESSAGE,
} from "@/lib/vercel-plan";
import { isOwnedBy } from "@/lib/visibility";

export async function GET(request: Request) {
  const { session, error } = await requireApiSession(request);
  if (error || !session) return error;
  const [jobs, schedulePlan] = await Promise.all([
    listJobs(session.user.id),
    resolveHostSchedulePlan(),
  ]);
  return NextResponse.json({ jobs, schedulePlan });
}

export async function POST(request: Request) {
  const { session, error } = await requireApiSession(request);
  if (error || !session) return error;
  const body = (await request.json()) as {
    prompt: string;
    firstRunAt?: string;
    everyMinutes?: number | null;
    cadence?: unknown;
  };
  const cadence = body.cadence !== undefined ? parseJobCadence(body.cadence) : null;
  if (body.cadence !== undefined && !cadence) {
    return NextResponse.json({ error: "That schedule timing is not valid." }, { status: 400 });
  }
  const fields = cadence ? scheduleFieldsFromCadence(cadence) : null;
  const blocked = await rejectSubDaily(cadence, fields?.everyMinutes ?? body.everyMinutes);
  if (blocked) return blocked;
  const firstRunAt = body.firstRunAt ?? fields?.nextRunAt;
  if (!body.prompt?.trim() || !firstRunAt) {
    return NextResponse.json({ error: "A prompt and first run time are required." }, { status: 400 });
  }
  const prompt = schedulePromptOrError(body.prompt);
  if (prompt instanceof NextResponse) return prompt;
  return NextResponse.json({
    job: await createJob(session.user.id, {
      prompt,
      firstRunAt,
      everyMinutes: fields?.everyMinutes ?? body.everyMinutes ?? null,
      cadence: fields?.cadence ?? null,
      authenticator: "better-auth",
      issuer: null,
    }),
  });
}

export async function PATCH(request: Request) {
  const { session, error } = await requireApiSession(request);
  if (error || !session) return error;
  const body = (await request.json()) as {
    id: string;
    prompt?: string;
    nextRunAt?: string;
    everyMinutes?: number | null;
    cadence?: unknown;
    enabled?: boolean;
  };
  const current = (await listJobs(session.user.id)).find((job) => job.id === body.id);
  if (!current) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!isOwnedBy(current, session.user.id)) {
    return NextResponse.json({ error: "You can only change schedules you created." }, { status: 403 });
  }
  const cadence = body.cadence !== undefined ? parseJobCadence(body.cadence) : undefined;
  if (body.cadence !== undefined && !cadence) {
    return NextResponse.json({ error: "That schedule timing is not valid." }, { status: 400 });
  }
  const fields = cadence ? scheduleFieldsFromCadence(cadence) : null;
  if (cadence || body.everyMinutes !== undefined) {
    const blocked = await rejectSubDaily(cadence ?? null, fields?.everyMinutes ?? body.everyMinutes);
    if (blocked) return blocked;
  }
  const prompt =
    body.prompt !== undefined ? schedulePromptOrError(body.prompt) : undefined;
  if (prompt instanceof NextResponse) return prompt;
  const job = await updateJob(
    session.user.id,
    body.id,
    compactPatch({
      prompt,
      enabled: body.enabled,
      ...(fields
        ? fields
        : {
            nextRunAt: body.nextRunAt,
            everyMinutes: body.everyMinutes,
          }),
    }),
  );
  if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ job });
}

export async function DELETE(request: Request) {
  const { session, error } = await requireApiSession(request);
  if (error || !session) return error;
  const { id } = (await request.json()) as { id: string };
  const current = (await listJobs(session.user.id)).find((job) => job.id === id);
  if (!current) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!isOwnedBy(current, session.user.id)) {
    return NextResponse.json({ error: "You can only delete schedules you created." }, { status: 403 });
  }
  const deleted = await deleteJob(session.user.id, id);
  if (!deleted) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

async function rejectSubDaily(
  cadence: ReturnType<typeof parseJobCadence> | undefined,
  everyMinutes?: number | null,
) {
  const plan = await resolveHostSchedulePlan();
  if (plan.allowsSubDaily || !cadenceFiresMoreThanOncePerDay(cadence, everyMinutes)) {
    return null;
  }
  return NextResponse.json({ error: SUB_DAILY_SCHEDULE_MESSAGE }, { status: 400 });
}

function schedulePromptOrError(prompt: string) {
  try {
    return normalizeSchedulePrompt(prompt);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "That schedule prompt is not valid." },
      { status: 400 },
    );
  }
}

function compactPatch<T extends object>(patch: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
}
