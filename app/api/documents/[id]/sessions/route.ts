import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/api";
import { attachDocument, detachDocument, getChat, listDocumentChats } from "@/lib/store";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { session, error } = await requireApiSession(request);
  if (error || !session) return error;
  const { id } = await params;
  const body = (await request.json()) as { chatId?: string };
  if (!body.chatId) {
    return NextResponse.json({ error: "chatId is required." }, { status: 400 });
  }
  const attached = await attachDocument(session.user.id, id, body.chatId);
  if (!attached) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ chats: await listDocumentChats(session.user.id, id) });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { session, error } = await requireApiSession(request);
  if (error || !session) return error;
  const { id } = await params;
  const body = (await request.json()) as { chatId?: string };
  if (!body.chatId) {
    return NextResponse.json({ error: "chatId is required." }, { status: 400 });
  }
  if (!(await getChat(session.user.id, body.chatId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  await detachDocument(session.user.id, id, body.chatId);
  return NextResponse.json({ chats: await listDocumentChats(session.user.id, id) });
}
