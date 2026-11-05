import { transcribe } from "ai";
import { NextResponse } from "next/server";
import { appConfig } from "@/app.config";
import { requireApiSession } from "@/lib/api";
import { estimateTranscriptionCostUsd } from "@/lib/model-prices";
import { RATE_LIMIT_MESSAGE, rateLimit } from "@/lib/rate-limit";
import { recordModelUsage } from "@/lib/record-usage";
import { runWithUsageScope } from "@/lib/usage-scope";

const maxAudioBytes = 25 * 1024 * 1024;
const transcriptionModel = appConfig.models.transcription;

/**
 * Voice input. Runs through AI Gateway with the same credentials as chat
 * (AI_GATEWAY_API_KEY locally, OIDC on Vercel), so there is no separate
 * provider key to set. Swap `models.transcription` in app.config.ts for any
 * Gateway transcription model.
 */
export async function POST(request: Request) {
  const { session, error } = await requireApiSession(request);
  if (error || !session) return error;
  if (!rateLimit(`transcribe:${session.user.id}`, { limit: 10, windowMs: 10 * 60 * 1000 })) {
    return NextResponse.json({ error: RATE_LIMIT_MESSAGE }, { status: 429 });
  }

  const form = await request.formData();
  const audio = form.get("audio");
  if (!(audio instanceof File) || audio.size === 0) {
    return NextResponse.json({ error: "Audio is required." }, { status: 400 });
  }
  if (audio.size > maxAudioBytes) {
    return NextResponse.json({ error: "Recording is too large." }, { status: 413 });
  }

  try {
    const result = await transcribe({
      model: transcriptionModel,
      audio: new Uint8Array(await audio.arrayBuffer()),
      abortSignal: AbortSignal.timeout(60_000),
      maxRetries: 1,
    });
    void runWithUsageScope({ userId: session.user.id }, () =>
      recordModelUsage({
        costUsd: estimateTranscriptionCostUsd(result.durationInSeconds, audio.size),
        inputTokens: 0,
        modelId: transcriptionModel,
        outputTokens: 0,
        purpose: "transcription",
        userId: session.user.id,
      }),
    );
    return NextResponse.json({ text: result.text.trim() });
  } catch (transcriptionError) {
    console.error("Transcription failed", transcriptionError);
    return NextResponse.json({ error: "Unable to transcribe audio." }, { status: 502 });
  }
}
