import { Client } from "eve/client";
import { selfOrigin } from "@/lib/internal-auth";

export function eveClientFromRequest(request: Request): Client {
  return new Client({
    host: selfOrigin(),
    headers: {
      cookie: request.headers.get("cookie") ?? "",
    },
  });
}

export async function teardownEveSession(request: Request, sessionId: string): Promise<void> {
  const session = eveClientFromRequest(request).sessions.attach(sessionId);
  try {
    await session.cancel();
  } catch {
    // No active turn, or the session is already gone.
  }
  try {
    await session.reset({ reason: "User deleted session" });
  } catch {
    // Already retired or unknown is a successful teardown.
  }
}
