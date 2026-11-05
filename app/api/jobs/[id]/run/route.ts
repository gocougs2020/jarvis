import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/api";
import { dispatchJobNow, startScheduleSession } from "@/lib/dispatch-jobs";
import { listJobs } from "@/lib/store";
import { isOwnedBy } from "@/lib/visibility";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { session, error } = await requireApiSession(request);
  if (error || !session) return error;
  const { id } = await context.params;
  const job = (await listJobs(session.user.id)).find((item) => item.id === id);
  if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!isOwnedBy(job, session.user.id)) {
    return NextResponse.json({ error: "You can only run schedules you created." }, { status: 403 });
  }
  try {
    await dispatchJobNow(job, (claimed, chat) => startScheduleSession(claimed, chat));
    const updated = (await listJobs(session.user.id)).find((item) => item.id === id);
    if (!updated) {
      return NextResponse.json({ deleted: true });
    }
    return NextResponse.json({ job: updated });
  } catch (runError) {
    const message = runError instanceof Error ? runError.message : "Unable to run this schedule.";
    return NextResponse.json({ error: message }, { status: 409 });
  }
}
