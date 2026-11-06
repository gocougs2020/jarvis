import { describe, expect, it } from "vitest";
import {
  activityLabel,
  activitySummary,
  emailCardFields,
  emailCardStatus,
  segmentMessageParts,
} from "./tool-activity";

const tool = (toolName: string, input: unknown = {}, state = "output-available") => ({
  toolName,
  input,
  state,
});

describe("activityLabel", () => {
  it("names searches, page reads, and delegated tasks by what they touched", () => {
    expect(activityLabel(tool("web_search", { query: "AI agent news" }))).toEqual({
      title: "Searched the web",
      detail: "AI agent news",
    });
    expect(activityLabel(tool("web_fetch", { url: "https://www.example.com/a/b?x=1" }))).toEqual({
      title: "Read",
      detail: "example.com/a/b",
    });
    expect(
      activityLabel(tool("agent", { message: "Research the week's agent launches" }, "input-available"))
        .title,
    ).toBe("Working on a delegated task");
  });

  it("falls back to a readable tool name", () => {
    expect(activityLabel(tool("crm__find_contact")).title).toBe("Crm find contact");
  });
});

describe("activitySummary", () => {
  it("counts each kind of step", () => {
    const parts = [
      tool("web_search"),
      tool("web_search"),
      tool("web_fetch"),
      tool("web_fetch"),
      tool("web_fetch"),
      tool("agent"),
    ];
    expect(activitySummary(parts)).toBe("Searched the web 2 times · read 3 pages · delegated a task");
  });

  it("uses the single step's own label", () => {
    expect(activitySummary([tool("web_search")])).toBe("Searched the web");
  });
});

describe("segmentMessageParts", () => {
  type Part = { type: string; id: string };
  const parts: Part[] = [
    { type: "step-start", id: "s0" },
    { type: "tool", id: "a" },
    { type: "step-start", id: "s1" },
    { type: "reasoning", id: "r" },
    { type: "tool", id: "b" },
    { type: "text", id: "t" },
    { type: "tool", id: "c" },
  ];

  it("folds runs of activity across step markers and hidden parts", () => {
    const segments = segmentMessageParts(
      parts,
      (part) => part.type === "tool",
      (part) => part.id,
      (part) => part.type === "reasoning",
    );
    expect(segments.map((segment) => segment.type)).toEqual(["activity", "part", "activity"]);
    expect(segments[0]).toMatchObject({ key: "activity:a", parts: [{ id: "a" }, { id: "b" }] });
    expect(segments[1]).toMatchObject({ index: 5 });
  });
});

describe("email cards", () => {
  it("shows a self-send as going to you until the result names the address", () => {
    const pending = { ...tool("send_email", { subject: "AI brief", body: "Hi" }, "input-available") };
    expect(emailCardStatus(pending)).toBe("sending");
    expect(emailCardFields(pending).to).toBe("You");

    const sent = {
      ...tool("send_email", { subject: "AI brief", body: "Hi", documentIds: ["d1"] }),
      output: { sent: true, to: ["ada@example.com"], href: "/inbox/e1", subject: "AI brief" },
    };
    expect(emailCardStatus(sent)).toBe("sent");
    expect(emailCardFields(sent)).toMatchObject({
      to: "ada@example.com",
      href: "/inbox/e1",
      attachmentCount: 1,
    });
  });

  it("flags a separate HTML body", () => {
    expect(emailCardFields(tool("send_email", { body: "a", html: "<p>b</p>" })).hasHtml).toBe(true);
    expect(emailCardFields(tool("send_email", { body: "a" })).hasHtml).toBe(false);
  });

  it("links only in-app paths", () => {
    const card = (href: string) =>
      emailCardFields({ ...tool("send_email"), output: { sent: true, href } }).href;
    expect(card("/inbox/e1")).toBe("/inbox/e1");
    expect(card("//evil.test/x")).toBeUndefined();
    expect(card("javascript:alert(1)")).toBeUndefined();
  });

  it("reports approvals, drafts, and failed sends", () => {
    expect(emailCardStatus(tool("send_email", {}, "approval-requested"))).toBe("awaiting-approval");
    expect(emailCardStatus({ ...tool("draft_email"), output: { status: "draft" } })).toBe("draft");
    expect(
      emailCardStatus({ ...tool("send_email"), output: { sent: false, message: "No Resend" } }),
    ).toBe("not-sent");
  });
});
