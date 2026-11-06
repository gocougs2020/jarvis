import { describe, expect, it } from "vitest";
import { rootSessionIdFromEvents } from "./session-events";

const called = (sessionId: string, childSessionId: string) => ({
  type: "subagent.called",
  data: { sessionId, childSessionId },
});

describe("rootSessionIdFromEvents", () => {
  it("maps a delegated child back to the session that called it", () => {
    const events = [{ type: "turn.started" }, called("root", "child-a"), called("root", "child-b")];
    expect(rootSessionIdFromEvents("child-b", events)).toBe("root");
  });

  it("follows nested delegation to the root", () => {
    expect(rootSessionIdFromEvents("grandchild", [called("root", "child"), called("child", "grandchild")])).toBe(
      "root",
    );
  });

  it("leaves a session no event names as a child alone", () => {
    expect(rootSessionIdFromEvents("root", [called("root", "child")])).toBe("root");
    expect(rootSessionIdFromEvents("root", [])).toBe("root");
  });

  it("stops on a cycle instead of looping", () => {
    expect(rootSessionIdFromEvents("a", [called("b", "a"), called("a", "b")])).toBe("a");
  });
});
