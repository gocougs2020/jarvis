import { rootSessionIdFromEvents } from "@/lib/session-events";
import { listChatOwnersForEveSession, updateChat } from "@/lib/store";
import type { ChatRecord } from "@/lib/types";

/**
 * A chat left pointing at a delegated child session goes back to its root
 * session, so opening it shows (and continues) the user's own conversation.
 */
export async function relinkRootSession(
  userId: string,
  chat: ChatRecord,
  events: readonly { readonly event: unknown }[],
): Promise<ChatRecord> {
  if (!chat.sessionId) return chat;
  const root = rootSessionIdFromEvents(
    chat.sessionId,
    events.map((row) => row.event as { type: string; data?: unknown }),
  );
  if (root === chat.sessionId) return chat;
  // The event log is written by the browser, so a forged subagent.called could
  // name someone else's session. Same rule as PATCH /api/chats/[id]: never
  // attach a session another account's chat already holds.
  const owners = await listChatOwnersForEveSession(root).catch(() => null);
  if (!owners || owners.some((owner) => owner !== userId)) return chat;
  // Only the server-side link moved to the child; the stream cursor was always
  // saved by the browser from the root session, so it stays.
  const updated = await updateChat(userId, chat.id, { sessionId: root }).catch(() => null);
  return updated ?? { ...chat, sessionId: root };
}
