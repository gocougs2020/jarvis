import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/api";
import { searchUserSessions } from "@/lib/session-memory";
import { createChat, listChats, titleFromPrompt } from "@/lib/store";
import { normalizeChatSource } from "@/lib/types";

export async function GET(request: Request) {
  const { session, error } = await requireApiSession(request);
  if (error || !session) return error;
  const query = new URL(request.url).searchParams.get("q")?.trim().slice(0, 500) ?? "";
  if (query) {
    return NextResponse.json({ chats: await searchUserSessions(session.user.id, query) });
  }
  return NextResponse.json({ chats: await listChats(session.user.id) });
}

export async function POST(request: Request) {
  const { session, error } = await requireApiSession(request);
  if (error || !session) return error;
  const body = (await request.json().catch(() => ({}))) as {
    title?: string;
    prompt?: string;
    source?: string;
  };
  const title = body.title?.trim() || titleFromPrompt(body.prompt ?? "New session");
  return NextResponse.json({
    chat: await createChat(session.user.id, title, normalizeChatSource(body.source)),
  });
}
