import { afterEach, describe, expect, it, vi } from "vitest";

const receivingGet = vi.fn();

vi.mock("@/lib/resend", () => ({
  getResend: () => ({ emails: { receiving: { get: receivingGet } } }),
}));

import {
  emailBodyForEmbedding,
  emailHasCompleteBodies,
  fetchReceivedEmailContent,
  htmlToText,
  normalizeEmailBodies,
  ReceivedEmailContentError,
  receivedThreadHeaders,
  textToHtml,
} from "@/lib/email-content";

describe("htmlToText", () => {
  it("keeps readable layout and drops markup, scripts, and data URIs", () => {
    const html = `
      <html>
        <head><style>p { color: red }</style></head>
        <body>
          <h1>Itinerary</h1>
          <p>Flight <strong>UA 123</strong> lands at 4pm.</p>
          <p><img src="data:image/png;base64,aaaa" alt="" /></p>
          <script>alert(1)</script>
        </body>
      </html>
    `;
    const text = htmlToText(html);
    expect(text).toContain("Itinerary");
    expect(text).toContain("Flight UA 123 lands at 4pm.");
    expect(text).not.toContain("<p>");
    expect(text).not.toContain("alert");
    expect(text).not.toContain("data:image");
    expect(text).not.toContain("color: red");
  });

  it("decodes entities", () => {
    expect(htmlToText("<p>A &amp; B &#39;quote&#39; &#x26; more</p>")).toBe("A & B 'quote' & more");
  });
});

describe("normalizeEmailBodies", () => {
  it("derives text from HTML-only mail", () => {
    const bodies = normalizeEmailBodies({
      html: "<div><p>Hold the 9am table.</p></div>",
      text: null,
    });
    expect(bodies.bodyHtml).toContain("<p>Hold the 9am table.</p>");
    expect(bodies.bodyText).toBe("Hold the 9am table.");
  });

  it("wraps text-only mail as HTML", () => {
    const bodies = normalizeEmailBodies({ html: "", text: "Line one\n\nLine two" });
    expect(bodies.bodyText).toBe("Line one\n\nLine two");
    expect(bodies.bodyHtml).toContain("<p>Line one</p>");
    expect(bodies.bodyHtml).toContain("<p>Line two</p>");
  });

  it("keeps both when Resend returns both", () => {
    const bodies = normalizeEmailBodies({
      html: "<p>Hello <em>Ada</em></p>",
      text: "Hello Ada",
    });
    expect(bodies.bodyHtml).toBe("<p>Hello <em>Ada</em></p>");
    expect(bodies.bodyText).toBe("Hello Ada");
  });
});

describe("emailHasCompleteBodies", () => {
  it("requires both representations", () => {
    expect(emailHasCompleteBodies({ bodyText: "hi", bodyHtml: "<p>hi</p>" })).toBe(true);
    expect(emailHasCompleteBodies({ bodyText: "", bodyHtml: "<p>hi</p>" })).toBe(false);
    expect(emailHasCompleteBodies({ bodyText: "hi", bodyHtml: "" })).toBe(false);
  });
});

describe("emailBodyForEmbedding", () => {
  it("prefers plain text over markup", () => {
    expect(
      emailBodyForEmbedding({
        bodyText: "Hold the 9am table.",
        bodyHtml: "<p>Hold the 9am table.</p>",
      }),
    ).toBe("Hold the 9am table.");
    expect(emailBodyForEmbedding({ bodyText: "", bodyHtml: "<p>Hold the 9am table.</p>" })).toBe(
      "Hold the 9am table.",
    );
  });
});

describe("textToHtml", () => {
  it("escapes markup in text", () => {
    expect(textToHtml("<script>alert(1)</script>")).toContain("&lt;script&gt;");
    expect(textToHtml("<script>alert(1)</script>")).not.toContain("<script>");
  });
});

describe("fetchReceivedEmailContent", () => {
  afterEach(() => {
    receivingGet.mockReset();
    vi.unstubAllGlobals();
  });

  it("stores HTML layout and text from receiving.get", async () => {
    receivingGet.mockResolvedValue({
      data: {
        subject: "Dinner",
        from: "Ada <ada@example.com>",
        to: ["agent@example.com"],
        cc: null,
        received_for: ["agent@example.com"],
        html: "<p>Table for <strong>two</strong>.</p>",
        text: "Hold a table for two.",
        attachments: [{ filename: "invite.pdf", content_type: "application/pdf", size: 1200 }],
      },
      error: null,
    });

    const content = await fetchReceivedEmailContent("email_123");
    expect(receivingGet).toHaveBeenCalledWith("email_123", { html_format: "data_uri" });
    expect(content.subject).toBe("Dinner");
    expect(content.bodyHtml).toBe("<p>Table for <strong>two</strong>.</p>");
    expect(content.bodyText).toBe("Hold a table for two.");
    expect(content.attachments).toEqual([
      { filename: "invite.pdf", contentType: "application/pdf", size: 1200 },
    ]);
  });

  it("derives text when Resend only returns HTML", async () => {
    receivingGet.mockResolvedValue({
      data: {
        subject: "Dinner",
        from: "ada@example.com",
        to: ["agent@example.com"],
        html: "<p>Table for two.</p>",
        text: null,
        attachments: [],
      },
      error: null,
    });

    const content = await fetchReceivedEmailContent("email_123");
    expect(content.bodyHtml).toContain("Table for two.");
    expect(content.bodyText).toBe("Table for two.");
  });

  it("parses raw MIME when html and text are empty", async () => {
    receivingGet.mockResolvedValue({
      data: {
        subject: "Raw",
        from: "ada@example.com",
        to: ["agent@example.com"],
        html: null,
        text: null,
        raw: { download_url: "https://example.com/raw.eml", expires_at: "2099-01-01T00:00:00Z" },
        attachments: [],
      },
      error: null,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        arrayBuffer: async () =>
          new TextEncoder().encode(
            [
              "From: ada@example.com",
              "Subject: Raw",
              "Content-Type: text/html; charset=utf-8",
              "",
              "<p>From the raw source.</p>",
            ].join("\r\n"),
          ).buffer,
      })),
    );

    const content = await fetchReceivedEmailContent("email_123");
    expect(content.bodyHtml).toContain("From the raw source.");
    expect(content.bodyText).toContain("From the raw source.");
  });

  it("throws a retryable error when receiving.get fails", async () => {
    receivingGet.mockResolvedValue({
      data: null,
      error: { message: "not ready" },
    });
    await expect(fetchReceivedEmailContent("email_123")).rejects.toMatchObject({
      name: "ReceivedEmailContentError",
      retryable: true,
    } satisfies Partial<ReceivedEmailContentError>);
  });
});

describe("thread headers", () => {
  afterEach(() => {
    receivingGet.mockReset();
    vi.unstubAllGlobals();
  });

  it("reads Message-ID, In-Reply-To, and References from Resend's header map", async () => {
    receivingGet.mockResolvedValue({
      data: {
        subject: "Re: Brief",
        from: "ada@example.com",
        to: ["agent@example.com"],
        html: "<p>More please.</p>",
        text: "More please.",
        message_id: "<Reply-1@mail.example.com>",
        headers: {
          "In-Reply-To": "<brief-1@send.example.com>",
          references: "<root@send.example.com>\r\n <brief-1@send.example.com>",
        },
        attachments: [],
      },
      error: null,
    });

    const content = await fetchReceivedEmailContent("email_123");
    expect(content.messageId).toBe("reply-1@mail.example.com");
    expect(content.inReplyTo).toEqual(["brief-1@send.example.com"]);
    expect(content.references).toEqual(["root@send.example.com", "brief-1@send.example.com"]);
  });

  it("falls back to the raw message when the header map has no thread headers", async () => {
    receivingGet.mockResolvedValue({
      data: {
        message_id: "reply-1@mail.example.com",
        headers: {},
        raw: { download_url: "https://example.com/raw.eml", expires_at: "2099-01-01T00:00:00Z" },
      },
      error: null,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        arrayBuffer: async () =>
          new TextEncoder().encode(
            [
              "From: ada@example.com",
              "Subject: Re: Brief",
              "Message-ID: <reply-1@mail.example.com>",
              "In-Reply-To: <brief-1@send.example.com>",
              "References: <root@send.example.com> <brief-1@send.example.com>",
              "Content-Type: text/plain; charset=utf-8",
              "",
              "More please.",
            ].join("\r\n"),
          ).buffer,
      })),
    );

    await expect(receivedThreadHeaders("email_123")).resolves.toEqual({
      messageId: "reply-1@mail.example.com",
      inReplyTo: ["brief-1@send.example.com"],
      references: ["root@send.example.com", "brief-1@send.example.com"],
    });
  });

  it("returns null when Resend has neither the email nor a raw message", async () => {
    receivingGet.mockResolvedValue({ data: null, error: { message: "gone" } });
    await expect(receivedThreadHeaders("email_123")).resolves.toBeNull();
  });
});
