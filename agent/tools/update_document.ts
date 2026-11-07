import { defineTool } from "eve/tools";
import { z } from "zod";
import { requireUser } from "../lib/identity";
import { toClientDocument, updateUserDocument } from "../../lib/documents";

export default defineTool({
  description:
    "Update an existing file's title, text content, folder, or public-share setting. Use after create_document or list_documents.",
  inputSchema: z.object({
    id: z.string().min(1),
    title: z.string().min(1).optional(),
    content: z.string().optional().describe("Replacement UTF-8 text for editable files."),
    isPublic: z.boolean().optional().describe("Deprecated. Use visibility: public or private."),
    visibility: z
      .enum(["private", "public"])
      .optional()
      .describe(
        "private keeps the file to the owner. public also gives it a link anyone on the internet can open.",
      ),
    folderId: z
      .string()
      .nullable()
      .optional()
      .describe("Move the file into this folder, or null to move it to the library root."),
  }),
  async execute(input, ctx) {
    const user = requireUser(ctx);
    const document = await updateUserDocument(user.userId, input.id, {
      content: input.content,
      folderId: input.folderId,
      isPublic: input.isPublic,
      visibility: input.visibility,
      title: input.title,
    });
    return toClientDocument(document, []);
  },
});
