import { defineChannel, POST } from "eve/channels";
import eve from "./eve";
import { isInternalDispatchRequest } from "../../lib/internal-auth";

type StartBody = {
  userId?: string;
  prompt?: string;
  email?: string;
  name?: string;
  chatId?: string;
};

export default defineChannel({
  routes: [
    POST("/api/internal/email-sessions", async (request, { to }) => {
      if (!isInternalDispatchRequest(request.headers.get("x-email-session-secret"))) {
        return new Response("Unauthorized", { status: 401 });
      }

      const body = (await request.json().catch(() => ({}))) as StartBody;
      if (!body.userId || !body.prompt?.trim()) {
        return Response.json({ error: "userId and prompt are required." }, { status: 400 });
      }

      const chatId = body.chatId?.trim();
      const session = await to(eve, chatId ? { address: chatId } : {}).send(body.prompt, {
        auth: {
          authenticator: "better-auth",
          principalId: body.userId,
          principalType: "user",
          attributes: {
            ...(body.email ? { email: body.email } : {}),
            ...(body.name ? { name: body.name } : {}),
            ...(chatId ? { chatId } : {}),
            source: "email",
          },
        },
      });

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
