/** Model routes the agent locks per session (see agent/lib/models.ts). */
export const QUICK_ROUTES = ["fast", "reason", "complex"] as const;
export type QuickRoute = (typeof QUICK_ROUTES)[number];

/** Request header the web client sends on the first agent turn after a quick hand-off. */
export const QUICK_ROUTE_HINT_HEADER = "x-jarvis-route-hint";

/** Request header naming the app chat a web eve request belongs to. */
export const WEB_CHAT_ID_HEADER = "x-jarvis-chat-id";

export function isQuickRoute(value: unknown): value is QuickRoute {
  return typeof value === "string" && (QUICK_ROUTES as readonly string[]).includes(value);
}
