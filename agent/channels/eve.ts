import type { UserContent } from "ai";
import type { ChannelReceiveContext } from "eve/channels";
import { type AuthFn, ForbiddenError, localDev, vercelOidc } from "eve/channels/auth";
import { eveChannel } from "eve/channels/eve";
import type { SessionAuthContext } from "eve/context";
import {
  SCHEDULE_DISPATCH_CHAT_HEADER,
  SCHEDULE_DISPATCH_JOB_HEADER,
  SCHEDULE_DISPATCH_REMINDER_HEADER,
  SCHEDULE_DISPATCH_SECRET_HEADER,
  SCHEDULE_DISPATCH_USER_HEADER,
  scheduleSessionAuth,
} from "../../lib/dispatch-jobs";
import { findUserById } from "../../lib/email-users";
import { eveSessionIdFromUrl, isInternalDispatchRequest } from "../../lib/internal-auth";
import { eveReceiveAddress } from "../../lib/eve-receive";

function betterAuthSession(): AuthFn<Request> {
  return async (request) => {
    const { getAuth, sessionIfAllowed } = await import("../../lib/auth");
    const { ensureNeonAuthSchema } = await import("../../lib/db");
    await ensureNeonAuthSchema();
    const session = await sessionIfAllowed(
      await getAuth().api.getSession({ headers: request.headers }),
      request.headers,
    );
    if (!session) return null;
    await assertSessionNotOwnedByAnotherUser(request, session.user.id);
    return {
      authenticator: "better-auth",
      principalId: session.user.id,
      principalType: "user",
      attributes: {
        email: session.user.email,
        name: session.user.name,
      },
    };
  };
}

/**
 * eve route auth does not enforce session ownership (see the eve auth guide).
 * A signed-in user may not continue, stream, or control a session that is
 * recorded on another user's chat. A brand-new session is not on any chat yet,
 * so the first stream is not held up waiting for the client to save it.
 */
async function assertSessionNotOwnedByAnotherUser(request: Request, userId: string) {
  const sessionId = eveSessionIdFromUrl(request.url);
  if (!sessionId) return;
  const { listChatOwnersForEveSession } = await import("../../lib/store");
  const owners = await listChatOwnersForEveSession(sessionId);
  if (owners.length > 0 && !owners.includes(userId)) {
    throw new ForbiddenError({ message: "This session belongs to another account." });
  }
}

function scheduleDispatchAuth(): AuthFn<Request> {
  return async (request) => {
    if (!isInternalDispatchRequest(request.headers.get(SCHEDULE_DISPATCH_SECRET_HEADER))) {
      return null;
    }
    const userId = request.headers.get(SCHEDULE_DISPATCH_USER_HEADER)?.trim();
    if (!userId) return null;
    const owner = await findUserById(userId);
    return scheduleSessionAuth({
      userId,
      email: owner?.email,
      name: owner?.name,
      chatId: request.headers.get(SCHEDULE_DISPATCH_CHAT_HEADER)?.trim(),
      scheduleId: request.headers.get(SCHEDULE_DISPATCH_JOB_HEADER)?.trim(),
      reminder: request.headers.get(SCHEDULE_DISPATCH_REMINDER_HEADER) === "1",
    });
  };
}

const channel = eveChannel({
  auth: [scheduleDispatchAuth(), betterAuthSession(), vercelOidc(), localDev()],
});

// eveChannel() has no receive option. Schedules and the email channel start
// web sessions with to(eve, { address }).send(...).
export default Object.assign(channel, {
  receive(
    input: {
      message: string | UserContent;
      target: Readonly<Record<string, unknown>>;
      auth: SessionAuthContext | null;
    },
    { from }: ChannelReceiveContext,
  ) {
    return from(eveReceiveAddress(input.target)).send(input.message, { auth: input.auth });
  },
});
