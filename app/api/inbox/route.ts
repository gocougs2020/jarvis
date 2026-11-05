import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/api";
import { ensureStoredEmailContent, searchUserInbox, toClientEmail } from "@/lib/email-inbox";
import { getEmail, listEmails } from "@/lib/store";
import type { EmailDirection } from "@/lib/types";

function asDirection(value: string | null): EmailDirection | undefined {
  return value === "inbound" || value === "outbound" ? value : undefined;
}

export async function GET(request: Request) {
  const { session, error } = await requireApiSession(request);
  if (error || !session) return error;

  const params = new URL(request.url).searchParams;
  const query = params.get("q")?.trim().slice(0, 500) ?? "";
  const direction = asDirection(params.get("direction"));
  const id = params.get("id")?.trim();

  if (id) {
    const email = await getEmail(session.user.id, id);
    if (!email) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ email: toClientEmail(await ensureStoredEmailContent(email)) });
  }

  if (query) {
    const results = await searchUserInbox(session.user.id, query, { direction });
    return NextResponse.json({
      emails: results.map((hit) => ({
        ...toClientEmail(hit.email, { includeBodies: false, bodyPreviewChars: 0 }),
        match: hit.match,
        score: hit.score,
      })),
    });
  }

  const emails = await listEmails(session.user.id, { direction });
  return NextResponse.json({
    emails: emails.map((email) => toClientEmail(email, { includeBodies: false, bodyPreviewChars: 0 })),
  });
}
