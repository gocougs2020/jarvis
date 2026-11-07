export const REQUIRED_SETUP_STEP_IDS = [
  "authSecret",
  "aiGateway",
  "hosted",
  "authUrl",
  "database",
  "blob",
  "owner",
] as const;

export type RequiredSetupStepId = (typeof REQUIRED_SETUP_STEP_IDS)[number];

/**
 * Required checklist items for this runtime.
 * Local `next dev` asks for `.env.local` values. Vercel asks for project env.
 * Hosting and storage are not local requirements — the app uses file fallbacks.
 */
export function visibleRequiredSetupSteps(
  status: { hosted: boolean; authSecret: boolean },
): readonly RequiredSetupStepId[] {
  if (status.hosted) {
    const hosted: RequiredSetupStepId[] = ["authUrl", "database", "blob", "owner"];
    return status.authSecret ? hosted : ["authSecret", ...hosted];
  }
  return ["authSecret", "aiGateway", "owner"];
}

export function shouldShowRequiredSetupStep(
  id: RequiredSetupStepId,
  status: { hosted: boolean; authSecret: boolean },
): boolean {
  return visibleRequiredSetupSteps(status).includes(id);
}

/** First incomplete required step for this runtime — local Gateway vs hosted URL/storage. */
export function nextOpenRequiredSetupStep(
  status: Record<RequiredSetupStepId, boolean>,
): RequiredSetupStepId {
  return visibleRequiredSetupSteps(status).find((id) => !status[id]) ?? "owner";
}
