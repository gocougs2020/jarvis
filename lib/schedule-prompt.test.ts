import { describe, expect, it } from "vitest";
import {
  isNudgeReminderSchedule,
  isRemindDoSchedule,
  isReminderSchedule,
  parseSchedulePrompt,
  remindFollowThroughPrompt,
  scheduleDispatchMessage,
  scheduleSessionUrl,
} from "@/lib/schedule-prompt";

describe("isReminderSchedule", () => {
  it("treats a no-skill prompt as a nudge", () => {
    expect(isNudgeReminderSchedule("Run now. Do not ask questions.\n\nGet a car battery.")).toBe(
      true,
    );
    expect(isReminderSchedule("Run now. Do not ask questions.\n\nGet a car battery.")).toBe(true);
  });

  it("treats /remind as a do-job reminder", () => {
    expect(isRemindDoSchedule("/remind\n\nRun now. Do not ask questions.\n\nDraft the recap.")).toBe(
      true,
    );
    expect(isRemindDoSchedule("/reminder\n\nDraft the recap.")).toBe(true);
    expect(isReminderSchedule("/remind\n\nDraft the recap.")).toBe(true);
    expect(isNudgeReminderSchedule("/remind\n\nDraft the recap.")).toBe(false);
  });

  it("is false for other skills", () => {
    expect(isReminderSchedule("/weekly-review\n\nRun now. Do not ask questions.\n\nFriday recap.")).toBe(
      false,
    );
  });
});

describe("scheduleDispatchMessage", () => {
  it("asks a nudge run to email the user with a session link", () => {
    const message = scheduleDispatchMessage(
      { id: "job-1", prompt: "Get a new battery for the car." },
      { chatId: "chat-1", origin: "https://app.example.com/" },
    );
    expect(message).toContain("Personal reminder");
    expect(message).toContain("send_email");
    expect(message).toContain("agent address");
    expect(message).toContain("https://app.example.com/s/chat-1");
    expect(message).toContain("No prior session or file cleared the reminder match floor");
    expect(message).not.toContain("complete the work");
  });

  it("injects only pre-matched nudge context", () => {
    const message = scheduleDispatchMessage(
      { id: "job-1", prompt: "Get a new battery for the car." },
      {
        chatId: "chat-1",
        origin: "https://app.example.com",
        context: "Session: Battery shopping (https://app.example.com/s/old)\nAGM vs lithium",
      },
    );
    expect(message).toContain("tight embedding match");
    expect(message).toContain("Battery shopping");
    expect(message).toContain("Do not search sessions or files");
  });

  it("asks a /remind do-job to check prior work, then email", () => {
    const message = scheduleDispatchMessage(
      { id: "job-3", prompt: "/remind\n\nDraft the Henderson recap." },
      { chatId: "chat-3", origin: "https://app.example.com" },
    );
    expect(message).toContain("follow-through");
    expect(message).toContain("/remind");
    expect(message).toContain("already done");
    expect(message).toContain("https://app.example.com/s/chat-3");
    expect(message).toContain("send_email");
  });

  it("keeps other skill runs as unattended work", () => {
    const message = scheduleDispatchMessage({
      id: "job-2",
      prompt: "/weekly-review\n\nFriday recap.",
    });
    expect(message).toContain("complete the work");
    expect(message).not.toContain("Personal reminder");
    expect(message).not.toContain("follow-through");
  });
});

describe("scheduleSessionUrl", () => {
  it("joins origin and chat id", () => {
    expect(scheduleSessionUrl("abc", "https://app.example.com/")).toBe(
      "https://app.example.com/s/abc",
    );
  });
});

describe("remindFollowThroughPrompt", () => {
  it("queues a /remind follow-through, not a nudge", () => {
    const prompt = remindFollowThroughPrompt("The account owner emailed: book the venue.");
    expect(isRemindDoSchedule(prompt)).toBe(true);
    expect(isNudgeReminderSchedule(prompt)).toBe(false);
    expect(parseSchedulePrompt(prompt).brief).toContain("book the venue");
  });
});
