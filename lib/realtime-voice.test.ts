import { describe, expect, it } from "vitest";
import { realtimeVoiceInstructions } from "./realtime-voice";

describe("realtimeVoiceInstructions", () => {
  const now = new Date("2026-11-08T17:30:00Z");

  it("tells the voice model it is speaking and has no tools", () => {
    const text = realtimeVoiceInstructions({
      appName: "Jarvis",
      now,
      timeZone: "America/Los_Angeles",
    });
    expect(text).toContain("You are Jarvis");
    expect(text).toContain("cannot use tools");
    expect(text).toContain("Never use markdown");
    expect(text).toContain("(America/Los_Angeles)");
    expect(text).not.toContain("Saved notes");
  });

  it("includes the name, saved notes, and standing instructions when present", () => {
    const text = realtimeVoiceInstructions({
      appName: "Jarvis",
      now,
      userName: "Sam",
      profileMemory: "- Prefers metric units",
      instructionOverlay: "Be blunt.",
    });
    expect(text).toContain("- The user's name: Sam");
    expect(text).toContain("- Prefers metric units");
    expect(text).toContain("Be blunt.");
  });

  it("caps long notes and instructions", () => {
    const text = realtimeVoiceInstructions({
      appName: "Jarvis",
      now,
      profileMemory: "~".repeat(5_000),
      instructionOverlay: "^".repeat(5_000),
    });
    expect(text.match(/~/g)?.length).toBe(2_000);
    expect(text.match(/\^/g)?.length).toBe(2_000);
  });
});
