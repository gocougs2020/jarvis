import { isAccessAllowlistActive } from "@/lib/access";
import { isAuthSecretConfigured } from "@/lib/auth-secret";
import { hasBlobStore } from "@/lib/blob-store";
import { hasNeon } from "@/lib/db";

export {
  REQUIRED_SETUP_STEP_IDS,
  nextOpenRequiredSetupStep,
  shouldShowRequiredSetupStep,
  visibleRequiredSetupSteps,
  type RequiredSetupStepId,
} from "@/lib/setup-steps";

export type SetupStatus = {
  /** Hide the setup screen when this is true. */
  allowlist: boolean;
  authSecret: boolean;
  authUrl: boolean;
  aiGateway: boolean;
  database: boolean;
  blob: boolean;
  hosted: boolean;
  voice: boolean;
  inbox: boolean;
  accountUsage: boolean;
  canWriteLocalEnv: boolean;
};

export function isHostedOnVercel(): boolean {
  return process.env.VERCEL === "1";
}

export function canWriteLocalEnv(): boolean {
  return process.env.NODE_ENV !== "production" && !isHostedOnVercel();
}

export function isCanonicalProductionAuthUrl(value: string | undefined): boolean {
  const raw = value?.trim();
  if (!raw) return false;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return false;
    const host = url.hostname.toLowerCase();
    if (!host || host === "localhost" || host === "127.0.0.1") return false;
    return true;
  } catch {
    return false;
  }
}

function hasText(value: string | undefined): boolean {
  return Boolean(value?.trim());
}

export function getSetupStatus(): SetupStatus {
  const hosted = isHostedOnVercel();
  return {
    allowlist: isAccessAllowlistActive(),
    authSecret: isAuthSecretConfigured(process.env.BETTER_AUTH_SECRET),
    authUrl: hosted ? isCanonicalProductionAuthUrl(process.env.BETTER_AUTH_URL) : true,
    aiGateway: hasText(process.env.AI_GATEWAY_API_KEY) || hosted,
    database: hasNeon(),
    blob: hasBlobStore(),
    hosted,
    // Voice runs through AI Gateway, so it is ready whenever chat is.
    voice: hasText(process.env.AI_GATEWAY_API_KEY) || hosted,
    inbox: hasText(process.env.RESEND_API_KEY) && hasText(process.env.RESEND_FROM_EMAIL),
    accountUsage: hasText(process.env.ALLOWED_ACCOUNT_USAGE_EMAILS),
    canWriteLocalEnv: canWriteLocalEnv(),
  };
}

export function isSetupScreenVisible(status: SetupStatus = getSetupStatus()): boolean {
  return !status.allowlist;
}
