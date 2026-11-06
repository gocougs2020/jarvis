import { defineChannel, POST } from "eve/channels";
import eve from "./eve";
import { isInternalDispatchRequest } from "../../lib/internal-auth";

type StartBody = {
  userId?: string;
  prompt?: string;
  email?: string;
  name?: string;
  chatId?: string;
  /** Continue this chat's existing session (an emailed reply) instead of starting one. */
  continueSessionId?: string;
};

export default defineChannel({
  routes: [
    POST("/api/internal/email-sessions", async (request, { to, attachSession }) => {
      if (!isInternalDispatchRequest(request.headers.get("x-email-session-secret"))) {
        return new Response("Unauthorized", { status: 401 });
      }

      const body = (await request.json().catch(() => ({}))) as StartBody;
      if (!body.userId || !body.prompt?.trim()) {
        return Response.json({ error: "userId and prompt are required." }, { status: 400 });
      }

      const chatId = body.chatId?.trim();
      const auth = {
        authenticator: "better-auth",
        principalId: body.userId,
        principalType: "user" as const,
        attributes: {
          ...(body.email ? { email: body.email } : {}),
          ...(body.name ? { name: body.name } : {}),
          ...(chatId ? { chatId } : {}),
          source: "email",
        },
      };

      const continueSessionId = body.continueSessionId?.trim();
      if (continueSessionId) {
        // Only the session recorded on this user's chat may be continued, and
        // only a chat that email started: web chats are used on the web only.
        const { getChat, updateChat } = await import("../../lib/store");
        const chat = chatId ? await getChat(body.userId, chatId) : null;
        if (!chat || chat.sessionId !== continueSessionId) {
          return Response.json({ error: "chat_session_mismatch" }, { status: 409 });
        }
        if (chat.source !== "email") {
          return Response.json({ error: "chat_not_email" }, { status: 409 });
        }
        // Queue behind a turn the owner may be running in the browser.
        const result = await attachSession(continueSessionId).send(body.prompt, {
          auth,
          turnPolicy: "queue",
        });
        if (result.status !== "accepted") {
          return Response.json({ error: result.status }, { status: 409 });
        }
        await updateChat(body.userId, chat.id, { touchUpdatedAt: true }).catch((error: unknown) =>
          console.error("[email] could not touch continued chat", error),
        );
        return Response.json({ sessionId: result.sessionId, continued: true });
      }

      const session = await to(eve, chatId ? { address: chatId } : {}).send(body.prompt, { auth });

      if (chatId) {
        // Record the session on its chat here, not only in the caller, so a
        // caller that timed out still leaves the chat linked to the running session.
        const { updateChat } = await import("../../lib/store");
        await updateChat(body.userId, chatId, { sessionId: session.id }).catch((error: unknown) =>
          console.error("[email] could not record session on chat", error),
        );
      }
      return Response.json({ sessionId: session.id });
    }),
  ],
});
