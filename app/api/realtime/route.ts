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

function field(body: unknown, name: string, max: number): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const value = (body as Record<string, unknown>)[name];
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, max)
    : undefined;
}

/**
 * Voice mode setup in one round trip: a short-lived AI Gateway client secret
 * for `models.realtime`, plus the voice instructions (the user's name, saved
 * notes, and standing tone instructions). The browser opens the realtime
 * WebSocket with the token and sends the instructions in its session update;
 * the Gateway credential (AI_GATEWAY_API_KEY locally, OIDC on Vercel) never
 * leaves the server. Nothing here starts an eve session.
 */
export async function POST(request: Request) {
  const { session, error } = await requireApiSession(request);
  if (error || !session) return error;
  const userId = session.user.id;
  if (
    !rateLimit(`realtime:${userId}`, {
      limit: 20,
      windowMs: 10 * 60 * 1000,
    })
  ) {
    return NextResponse.json({ error: RATE_LIMIT_MESSAGE }, { status: 429 });
  }
  const body: unknown = await request.json().catch(() => null);
  const tokenPromise = gateway.experimental_realtime.getToken({
    model: realtimeModel,
    expiresAfterSeconds: 60,
  });
  // Settle the token even if the instructions lookup throws first.
  tokenPromise.catch(() => undefined);
  const [settings, memories] = await Promise.all([
    getUserSettings(userId).catch(() => null),
    listProfileMemories(userId).catch(() => []),
  ]);
  const instructions = realtimeVoiceInstructions({
    appName: APP_NAME,
    now: new Date(),
    timeZone: field(body, "timeZone", 64),
    locale: field(body, "locale", 35),
    userName: session.user.name,
    instructionOverlay: settings?.instructionOverlay,
    profileMemory: memories.map((entry) => `- ${entry.text}`).join("\n"),
  });
  try {
    const { token, url, expiresAt } = await tokenPromise;
    return NextResponse.json(
      { token, url, expiresAt, instructions },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (tokenError) {
    console.error("Realtime token request failed", tokenError);
    return NextResponse.json(
      {
        error:
          "Voice mode could not get a session from AI Gateway. Check the Gateway credentials and that the voice model is available.",
      },
      { status: 502 },
    );
  }
}
