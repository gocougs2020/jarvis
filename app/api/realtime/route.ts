import { gateway } from "ai";
import { NextResponse } from "next/server";
import { appConfig } from "@/app.config";
import { requireApiSession } from "@/lib/api";
import { APP_NAME } from "@/lib/brand";
import { listProfileMemories } from "@/lib/profile-memory";
import { RATE_LIMIT_MESSAGE, rateLimit } from "@/lib/rate-limit";
import { realtimeVoiceInstructions } from "@/lib/realtime-voice";
import { getUserSettings } from "@/lib/store";

export const runtime = "nodejs";

const realtimeModel = appConfig.models.realtime;

function param(url: URL, name: string, max: number): string | undefined {
  const value = url.searchParams.get(name)?.trim();
  return value ? value.slice(0, max) : undefined;
}

/**
 * Voice mode instructions: the user's name, saved notes, and standing tone
 * instructions, for the realtime model the browser talks to directly.
 */
export async function GET(request: Request) {
  const { session, error } = await requireApiSession(request);
  if (error || !session) return error;
  const userId = session.user.id;
  const url = new URL(request.url);
  const [settings, memories] = await Promise.all([
    getUserSettings(userId).catch(() => null),
    listProfileMemories(userId).catch(() => []),
  ]);
  const instructions = realtimeVoiceInstructions({
    appName: APP_NAME,
    now: new Date(),
    timeZone: param(url, "timeZone", 64),
    locale: param(url, "locale", 35),
    userName: session.user.name,
    instructionOverlay: settings?.instructionOverlay,
    profileMemory: memories.map((entry) => `- ${entry.text}`).join("\n"),
  });
  return NextResponse.json(
    { instructions },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

/**
 * Mints a short-lived AI Gateway client secret for `models.realtime`. The
 * browser opens the realtime WebSocket with it; the Gateway credential
 * (AI_GATEWAY_API_KEY locally, OIDC on Vercel) never leaves the server.
 * Called by `experimental_useRealtime`, which expects `{ token, url, tools }`.
 */
export async function POST(request: Request) {
  const { session, error } = await requireApiSession(request);
  if (error || !session) return error;
  if (
    !rateLimit(`realtime:${session.user.id}`, {
      limit: 20,
      windowMs: 10 * 60 * 1000,
    })
  ) {
    return NextResponse.json({ error: RATE_LIMIT_MESSAGE }, { status: 429 });
  }
  try {
    const { token, url, expiresAt } =
      await gateway.experimental_realtime.getToken({
        model: realtimeModel,
        expiresAfterSeconds: 60,
      });
    return NextResponse.json(
      { token, url, expiresAt, tools: [] },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (tokenError) {
    console.error("Realtime token request failed", tokenError);
    return NextResponse.json(
      { error: "Unable to start voice mode." },
      { status: 502 },
    );
  }
}
