import { beforeEach, describe, expect, it, vi } from "vitest";

const chunks = vi.hoisted(() => ({ current: [] as string[] }));

vi.mock("ai", () => ({
  streamText: () => ({
    textStream: (async function* () {
      for (const chunk of chunks.current) yield chunk;
    })(),
    totalUsage: Promise.resolve({ inputTokens: 1, outputTokens: 1 }),
  }),
}));
vi.mock("@/lib/api", () => ({
  requireApiSession: async () => ({
    session: { user: { id: "user-1", name: "Sam", email: "sam@example.com" } },
    error: null,
  }),
}));
vi.mock("@/lib/store", () => ({
  getChat: async () => null,
  getUserSettings: async () => ({ instructionOverlay: "" }),
}));
vi.mock("@/lib/profile-memory", () => ({ listProfileMemories: async () => [] }));
vi.mock("@/lib/record-usage", () => ({ recordGenerateTextUsage: async () => undefined }));

const { POST } = await import("./route");

async function run(output: string[]) {
  chunks.current = output;
  const response = await POST(
    new Request("http://localhost/api/quick", {
      body: JSON.stringify({ prompt: "hello", timeZone: "UTC" }),
      method: "POST",
    }),
  );
  const body = await response.text();
  return body
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe("POST /api/quick", () => {
  beforeEach(() => {
    process.env.BETTER_AUTH_SECRET = "test-secret";
  });

  it("streams a direct answer after the decision line", async () => {
    const events = await run(["ANS", "WER\nIt is ", "Friday."]);
    expect(events[0]).toEqual({ type: "decision", mode: "answer" });
    const text = events.filter((event) => event.type === "text").map((event) => event.delta);
    expect(text.join("")).toBe("It is Friday.");
    expect(events.at(-1)).toEqual({ type: "done" });
  });

  it("hands off with a signed route and stops after one sentence", async () => {
    const events = await run(["AGENT complex\nResearching", " that now.\nExtra line", " ignored"]);
    expect(events[0]).toMatchObject({ type: "decision", mode: "agent", route: "complex" });
    expect(typeof events[0]?.hint).toBe("string");
    const text = events.filter((event) => event.type === "text").map((event) => event.delta);
    expect(text.join("")).toBe("Researching that now.");
    expect(events.at(-1)).toEqual({ type: "done" });
  });

  it("hands off when the model ignores the format", async () => {
    const events = await run(["Sure thing! Here is a long answer without a decision line"]);
    expect(events[0]).toMatchObject({ type: "decision", mode: "agent", route: "reason" });
    expect(events.some((event) => event.type === "text")).toBe(false);
  });

  it("accepts a bare decision with no newline", async () => {
    const events = await run(["AGENT fast"]);
    expect(events[0]).toMatchObject({ type: "decision", mode: "agent", route: "fast" });
  });
});
