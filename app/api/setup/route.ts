import { NextResponse } from "next/server";
import { generateAuthSecret } from "@/lib/auth-secret";
import { normalizeEmailAddress } from "@/lib/email-users";
import { isCrossSiteRequest } from "@/lib/internal-auth";
import { clientKey, RATE_LIMIT_MESSAGE, rateLimit } from "@/lib/rate-limit";
import { localEnvFilePath, upsertEnvFile, type SetupEnvWritableKey } from "@/lib/setup-env-file";
import { canWriteLocalEnv, getSetupStatus } from "@/lib/setup-status";

function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function writeLocalEnv(key: SetupEnvWritableKey, value: string) {
  upsertEnvFile(localEnvFilePath(), key, value);
  process.env[key] = value;
}

export async function GET() {
  return NextResponse.json({ status: getSetupStatus() });
}

export async function POST(request: Request) {
  if (isCrossSiteRequest(request)) {
    return NextResponse.json({ error: "Cross-site request refused." }, { status: 403 });
  }
  if (!rateLimit(clientKey(request, "setup"), { limit: 20, windowMs: 15 * 60 * 1000 })) {
    return NextResponse.json({ error: RATE_LIMIT_MESSAGE }, { status: 429 });
  }

  let body: {
    action?: string;
    secret?: string;
    email?: string;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "That request was not valid." }, { status: 400 });
  }

  const action = body.action;
  if (action === "generate-secret") {
    return NextResponse.json({
      secret: generateAuthSecret(),
      status: getSetupStatus(),
    });
  }

  if (!canWriteLocalEnv() || getSetupStatus().owner) {
    return NextResponse.json(
      { error: "This computer cannot save settings into .env.local." },
      { status: 403 },
    );
  }

  if (action === "save-secret") {
    const secret = body.secret?.trim() || generateAuthSecret();
    if (!/^[A-Za-z0-9_\-+/=.]{32,512}$/.test(secret)) {
      return NextResponse.json(
        { error: "Use 32 or more letters, digits, or - _ + / = . characters." },
        { status: 400 },
      );
    }
    writeLocalEnv("BETTER_AUTH_SECRET", secret);
    return NextResponse.json({
      secret,
      saved: true,
      status: getSetupStatus(),
    });
  }

  if (action === "save-owner-email") {
    const email = normalizeEmailAddress(body.email ?? "");
    if (!looksLikeEmail(email)) {
      return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
    }
    writeLocalEnv("OWNER_EMAIL", email);
    return NextResponse.json({
      saved: true,
      status: getSetupStatus(),
    });
  }

  return NextResponse.json({ error: "Unknown setup action." }, { status: 400 });
}
