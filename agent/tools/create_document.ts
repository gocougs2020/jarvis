import { defineTool } from "eve/tools";
import { z } from "zod";
import { chatSessionId, requireUser } from "../lib/identity";
import { workspace } from "../lib/workspace-state";
import { createUserDocument, toClientDocument } from "../../lib/documents";
import { isDocumentKind } from "../../lib/document-kind";

export default defineTool({
  description:
    "Create a file in the user's library. Use for notes, reports, plans, CSV tables, HTML pages, Markdown, or any artifact they asked you to write or save.",
  inputSchema: z.object({
    title: z.string().min(1).describe("Human-readable file title."),
    kind: z
      .enum(["markdown", "html", "text", "csv", "json", "image", "pdf", "other"])
      .describe("File type. Prefer markdown for reports and csv for tables."),
    content: z
      .string()
      .describe("UTF-8 text for text kinds, or base64 for image/pdf/other."),
    filename: z.string().optional(),
    mimeType: z.string().optional(),
    encoding: z.enum(["utf8", "base64"]).optional(),
    isPublic: z
      .boolean()
      .optional()
      .describe("Deprecated. Use visibility: public to create a public internet share link."),
    visibility: z
      .enum(["private", "public"])
      .optional()
      .describe(
        "private (default) keeps the file to the owner. public also gives it a link anyone on the internet can open.",
      ),
    folderId: z
      .string()
      .optional()
      .describe("Existing folder id to file this in. Omit to keep it at the library root."),
  }),
  async execute(input, ctx) {
    const user = requireUser(ctx);
    const encoding = input.encoding ?? (input.kind === "image" || input.kind === "pdf" || input.kind === "other" ? "base64" : "utf8");
    const content =
      encoding === "base64" ? Buffer.from(input.content, "base64") : input.content;
    if (!isDocumentKind(input.kind)) {
      throw new Error("Unsupported file kind.");
    }
    const document = await createUserDocument(user.userId, {
      content,
      eveSessionId: chatSessionId(ctx),
      filename: input.filename,
      folderId: input.folderId,
      isPublic: input.isPublic,
      visibility: input.visibility,
      kind: input.kind,
      mimeType: input.mimeType,
      title: input.title,
    });
    workspace.update((state) => ({ ...state, activeDocumentId: document.id }));
    return toClientDocument(document, []);
  },
});
