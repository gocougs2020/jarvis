import type { MessageStreamEvent } from "eve/client";
import { describe, expect, it, vi } from "vitest";
import {
  hasUnseenSessionEvents,
  shouldProbeForServerTurns,
  shouldResumeEveSession,
  type SessionStreamProbeClient,
} from "@/lib/session-events";

function event(type: string): MessageStreamEvent {
  return { type, data: {}, meta: { id: `${type}-id`, at: "2026-09-11T00:00:00.000Z" } } as unknown as MessageStreamEvent;
}

function probeClient(events: readonly unknown[], fail = false) {
  const stream = vi.fn<SessionStreamProbeClient["sessions"]["attach"] extends (
    ...args: never[]
  ) => { stream: infer S }
    ? S
    : never>(() => ({
    async *[Symbol.asyncIterator]() {
      if (fail) throw new Error("403");
      yield* events;
    },
  }));
  const attach = vi.fn<SessionStreamProbeClient["sessions"]["attach"]>(() => ({ stream }));
  const client: SessionStreamProbeClient = { sessions: { attach } };
  return { attach, client, stream };
}

describe("shouldProbeForServerTurns", () => {
  it("probes a settled chat, which does not resume on load", () => {
    const settled = [event("turn.started"), event("session.waiting")];
    expect(shouldResumeEveSession("wrun_1", settled)).toBe(false);
    expect(shouldProbeForServerTurns("wrun_1", settled)).toBe(true);
  });

  it("skips chats without a session, unfinished turns, and finished sessions", () => {
    expect(shouldProbeForServerTurns(null, [event("session.waiting")])).toBe(false);
    expect(shouldProbeForServerTurns("wrun_1", [event("turn.started")])).toBe(false);
    expect(shouldProbeForServerTurns("wrun_1", [event("session.completed")])).toBe(false);
  });
});

describe("hasUnseenSessionEvents", () => {
  it("reads a bounded stream from the saved cursor and stops at the first event", async () => {
    const { attach, client, stream } = probeClient([{ type: "turn.started" }, { type: "message.completed" }]);
    await expect(hasUnseenSessionEvents(client, "wrun_1", 42)).resolves.toBe(true);
    expect(attach).toHaveBeenCalledWith("wrun_1", { streamIndex: 42 });
    expect(stream).toHaveBeenCalledWith(expect.objectContaining({ follow: false }));
  });

  it("reports nothing new at the tail", async () => {
    const { client } = probeClient([]);
    await expect(hasUnseenSessionEvents(client, "wrun_1", 42)).resolves.toBe(false);
  });

  it("treats a failed read as nothing new", async () => {
    const { client } = probeClient([], true);
    await expect(hasUnseenSessionEvents(client, "wrun_1", 42)).resolves.toBe(false);
  });
});
