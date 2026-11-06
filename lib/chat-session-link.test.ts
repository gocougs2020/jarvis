import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatRecord } from "@/lib/types";

const store = vi.hoisted(() => ({
  listChatOwnersForEveSession: vi.fn(),
  updateChat: vi.fn(),
}));
vi.mock("@/lib/store", () => store);

const { relinkRootSession } = await import("./chat-session-link");

const chat = { id: "chat-1", sessionId: "child" } as ChatRecord;
const rows = [{ event: { type: "subagent.called", data: { sessionId: "root", childSessionId: "child" } } }];

describe("relinkRootSession", () => {
  beforeEach(() => {
    store.listChatOwnersForEveSession.mockReset();
    store.updateChat.mockReset();
    store.updateChat.mockImplementation(async (_user, _id, patch) => ({ ...chat, ...patch }));
  });

  it("moves a chat off a delegated child onto its root session", async () => {
    store.listChatOwnersForEveSession.mockResolvedValue(["user-1"]);
    await expect(relinkRootSession("user-1", chat, rows)).resolves.toMatchObject({ sessionId: "root" });
    expect(store.updateChat).toHaveBeenCalledWith("user-1", "chat-1", { sessionId: "root" });
  });

  it("refuses a root session another account holds", async () => {
    store.listChatOwnersForEveSession.mockResolvedValue(["someone-else"]);
    await expect(relinkRootSession("user-1", chat, rows)).resolves.toBe(chat);
    expect(store.updateChat).not.toHaveBeenCalled();
  });

  it("leaves a chat on its own session alone", async () => {
    await expect(relinkRootSession("user-1", { ...chat, sessionId: "root" }, rows)).resolves.toMatchObject({
      sessionId: "root",
    });
    expect(store.listChatOwnersForEveSession).not.toHaveBeenCalled();
  });
});
