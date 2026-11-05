import { generateSpeech } from "ai";
import { NextResponse } from "next/server";
import { appConfig } from "@/app.config";
import { requireApiSession } from "@/lib/api";
import { estimateSpeechCostUsd } from "@/lib/model-prices";
import { RATE_LIMIT_MESSAGE, rateLimit } from "@/lib/rate-limit";
import { recordModelUsage } from "@/lib/record-usage";
import { speakableText } from "@/lib/speech-text";
import { getChat } from "@/lib/store";
import { runWithUsageScope } from "@/lib/usage-scope";

const speechModel = appConfig.models.speech;

/**
 * Spoken replies for voice mode. Runs through AI Gateway with the same
 * credentials as chat (AI_GATEWAY_API_KEY locally, OIDC on Vercel). Swap
 * `models.speech` and `voice.speechVoice` in app.config.ts to change the voice.
 * The only database work is an ownership check on `chatId` and the usage row.
 */
export async function POST(request: Request) {
  const { session, error } = await requireApiSession(request);
  if (error || !session) return error;
  if (!rateLimit(`speech:${session.user.id}`, { limit: 30, windowMs: 10 * 60 * 1000 })) {
    return NextResponse.json({ error: RATE_LIMIT_MESSAGE }, { status: 429 });
  }

  const body = (await request.json().catch(() => ({}))) as { text?: unknown; chatId?: unknown };
  const raw = typeof body.text === "string" ? body.text : "";
  const text = speakableText(raw, appConfig.voice.maxSpeechChars);
  if (!text) {
    return NextResponse.json({ error: "Text is required." }, { status: 400 });
  }
  // Attribute usage to the chat only when it belongs to the caller.
  const requestedChatId = typeof body.chatId === "string" ? body.chatId : undefined;
  const chatId =
    requestedChatId && (await getChat(session.user.id, requestedChatId))
      ? requestedChatId
      : undefined;

  try {
    const result = await generateSpeech({
      model: speechModel,
      text,
      voice: appConfig.voice.speechVoice,
      outputFormat: "mp3",
      abortSignal: AbortSignal.timeout(45_000),
      maxRetries: 1,
    });
    void runWithUsageScope({ userId: session.user.id, chatId }, () =>
      recordModelUsage({
        chatId,
        costUsd: estimateSpeechCostUsd(speechModel, text.length),
        inputTokens: 0,
        modelId: speechModel,
        outputTokens: 0,
        purpose: "speech",
        userId: session.user.id,
      }),
    );
    const audio = result.audio.uint8Array;
    return new Response(audio as unknown as BodyInit, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Length": String(audio.byteLength),
        "Content-Type": result.audio.mediaType || "audio/mpeg",
      },
    });
  } catch (speechError) {
    console.error("Speech generation failed", speechError);
    return NextResponse.json({ error: "Unable to speak this reply." }, { status: 502 });
  }
}
