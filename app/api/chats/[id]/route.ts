import { NextResponse } from "next/server";
import { compactStreamEvents } from "@/lib/chat-event-compaction";
import { requireApiSession } from "@/lib/api";
import { relinkRootSession } from "@/lib/chat-session-link";
import { teardownEveSession } from "@/lib/eve-session";
import {
  deleteChat,
  getChat,
  listChatEvents,
  listChatOwnersForEveSession,
  updateChat,
} from "@/lib/store";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { session, error } = await requireApiSession(request);
  if (error || !session) return error;
  const { id } = await params;
  const found = await getChat(session.user.id, id);
  if (!found) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const rows = await listChatEvents(id);
  const chat = await relinkRootSession(session.user.id, found, rows);
  return NextResponse.json({
    chat,
    events: compactStreamEvents(rows.map((row) => row.event as { type: string })),
  });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { session, error } = await requireApiSession(request);
  if (error || !session) return error;
  const { id } = await params;
  const body = (await request.json()) as {
    title?: string;
    description?: string;
    sessionId?: string | null;
    streamIndex?: number;
    touchUpdatedAt?: boolean;
  };
  if (typeof body.sessionId === "string" && body.sessionId) {
    // The eve channel lets every user recorded on a session continue it, so a
    // user must not attach a session that already belongs to someone else.
    const owners = await listChatOwnersForEveSession(body.sessionId);
    if (owners.some((owner) => owner !== session.user.id)) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
  }
  const chat = await updateChat(session.user.id, id, body);
  if (!chat) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ chat });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { session, error } = await requireApiSession(request);
  if (error || !session) return error;
  const { id } = await params;
  const chat = await getChat(session.user.id, id);
  if (!chat) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (chat.sessionId) {
    await teardownEveSession(request, chat.sessionId);
  }
  await deleteChat(session.user.id, id);
  return NextResponse.json({ ok: true });
}
