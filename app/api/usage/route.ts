import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/api";
import { extrasTotals, summarizeUsageRecords, toUsagePageSnapshot } from "@/lib/usage";
import { getChat, listChatUsage, listChats, listUserUsage } from "@/lib/store";

export async function GET(request: Request) {
  const { session, error } = await requireApiSession(request);
  if (error || !session) return error;

  const url = new URL(request.url);
  const chatId = url.searchParams.get("chatId")?.trim();
  if (chatId) {
    if (!(await getChat(session.user.id, chatId))) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const records = await listChatUsage(session.user.id, chatId);
    const summary = summarizeUsageRecords(records);
    return NextResponse.json({
      extras: extrasTotals(records),
      totals: summary.totals,
      byPurpose: summary.byPurpose,
    });
  }

  const [records, chats] = await Promise.all([
    listUserUsage(session.user.id),
    listChats(session.user.id),
  ]);
  return NextResponse.json(toUsagePageSnapshot(records, chats, { includeSessions: true }));
}
