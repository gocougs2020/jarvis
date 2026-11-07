import { defineTool } from "eve/tools";
import { z } from "zod";
import { requireUser } from "../lib/identity";
import { getUserDocument, readDocumentText, toClientDocument } from "../../lib/documents";
import { isTextDocumentKind } from "../../lib/document-kind";

export default defineTool({
  description:
    "Read a file the user already has. Returns text for editable files, or metadata for images and PDFs.",
  inputSchema: z.object({
    id: z.string().min(1),
  }),
  async execute(input, ctx) {
    const user = requireUser(ctx);
    const document = await getUserDocument(user.userId, input.id);
    if (!isTextDocumentKind(document.kind)) {
      return {
        document: toClientDocument(document, []),
        content: null,
        note: "This file is not text. Open the file link to view or download it.",
      };
    }
    const content = await readDocumentText(document);
    return { document: toClientDocument(document, []), content };
  },
});
