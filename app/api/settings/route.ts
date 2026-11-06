import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/api";
import { inboundMailPayload } from "@/lib/inbound-mail-payload";
import { getUserSettings, upsertUserSettings } from "@/lib/store";
import type { ModelTier } from "@/lib/types";

export async function GET(request: Request) {
  const { session, error } = await requireApiSession(request);
  if (error || !session) return error;
  const settings = await getUserSettings(session.user.id);
  return NextResponse.json({
    settings: {
      userId: settings.userId,
      modelTier: settings.modelTier,
      instructionOverlay: settings.instructionOverlay,
    },
    inboundMail: await inboundMailPayload(),
  });
}

export async function PATCH(request: Request) {
  const { session, error } = await requireApiSession(request);
  if (error || !session) return error;
  const body = (await request.json()) as {
    modelTier?: ModelTier;
    instructionOverlay?: string;
  };
  const settings = await upsertUserSettings(session.user.id, {
    ...(body.modelTier !== undefined ? { modelTier: body.modelTier } : {}),
    ...(body.instructionOverlay !== undefined
      ? { instructionOverlay: body.instructionOverlay }
      : {}),
  });
  return NextResponse.json({
    settings: {
      userId: settings.userId,
      modelTier: settings.modelTier,
      instructionOverlay: settings.instructionOverlay,
    },
    inboundMail: await inboundMailPayload(),
  });
}
