import { notFound } from "next/navigation";
import { compactStreamEvents } from "@/lib/chat-event-compaction";
import type { MessageStreamEvent } from "eve/client";
import { SessionClient } from "@/app/s/[sessionId]/session-client";
import { requireSession } from "@/lib/session";
import { getChat, listChatEvents } from "@/lib/store";

export default async function SessionPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly sessionId: string }>;
  readonly searchParams: Promise<{
    readonly from?: string | string[];
    readonly docs?: string | string[];
    readonly doc?: string | string[];
  }>;
}) {
  const session = await requireSession();
  const { sessionId } = await params;
  const query = await searchParams;
  const from = Array.isArray(query.from) ? query.from[0] : query.from;
  const docs = Array.isArray(query.docs) ? query.docs[0] : query.docs;
  const doc = Array.isArray(query.doc) ? query.doc[0] : query.doc;
  const chat = await getChat(session.user.id, sessionId);
  if (!chat) notFound();
  const events = await listChatEvents(chat.id);

  return (
    <SessionClient
      chat={chat}
      from={from}
      initialCanvasOpen={docs === "1" || Boolean(doc)}
      initialDocumentId={doc}
      initialEvents={compactStreamEvents(events.map((row) => row.event) as MessageStreamEvent[])}
    />
  );
}
