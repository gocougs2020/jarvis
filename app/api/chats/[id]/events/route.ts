import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/api";
import { syncChatUsageFromEvents } from "@/lib/record-usage";
import { getChat, replaceChatEvents, upsertChatEvent, writeChatEventsTail } from "@/lib/store";

/** Rows per request. The client batches a whole checkpoint into one call. */
const MAX_EVENTS_PER_REQUEST = 5_000;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { session, error } = await requireApiSession(request);
  if (error || !session) return error;
  const { id } = await params;
  if (!(await getChat(session.user.id, id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const body = (await request.json()) as {
    index?: number;
    event?: unknown;
    events?: unknown[];
    /** Tail checkpoint: `events` start at this index; rows past `total` are dropped. */
    fromIndex?: number;
    total?: number;
    /** Set once the turn has settled, so usage is tallied once per turn, not per write. */
    final?: boolean;
  };
  const count = Array.isArray(body.events) ? body.events.length : 1;
  if (count > MAX_EVENTS_PER_REQUEST) {
    return NextResponse.json({ error: "Too many events" }, { status: 413 });
  }
  try {
    if (
      Array.isArray(body.events) &&
      Number.isInteger(body.fromIndex) &&
      Number.isInteger(body.total) &&
      (body.fromIndex as number) >= 0 &&
      (body.total as number) >= (body.fromIndex as number) + body.events.length
    ) {
      await writeChatEventsTail(id, body.fromIndex as number, body.events, body.total as number);
    } else if (Array.isArray(body.events)) {
      await replaceChatEvents(id, body.events);
    } else if (typeof body.index === "number") {
      await upsertChatEvent(id, body.index, body.event);
    }
    if (body.final) void syncChatUsageFromEvents(session.user.id, id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[chat-events] persist failed", { chatId: id, count, error });
    return NextResponse.json({ error: "Failed to persist events" }, { status: 500 });
  }
}
