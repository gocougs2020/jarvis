import { defineTool } from "eve/tools";
import { z } from "zod";
import { chatSessionId, requireUser } from "../lib/identity";
import { getChatByEveSessionId, listChatDocuments, listDocuments, listFolders } from "../../lib/store";
import { searchUserLibrary, toClientDocument } from "../../lib/documents";

export default defineTool({
  description:
    "List or search files this user can see: their own files, plus files others shared with the app. Use query to find files by name, filename, contents, or a description of what the file is about.",
  inputSchema: z.object({
    sessionOnly: z.boolean().optional(),
    folderId: z
      .string()
      .nullable()
      .optional()
      .describe("If set, only files in this folder. Null lists files at the library root."),
    query: z
      .string()
      .optional()
      .describe("Search by file name, contents, or a natural-language description of the file."),
  }),
  async execute(input, ctx) {
    const user = requireUser(ctx);
    const query = input.query?.trim();
    if (query && !input.sessionOnly) {
      const results = await searchUserLibrary(user.userId, query);
      return results.flatMap((hit) => (hit.document ? [hit.document] : [])).slice(0, 40);
    }

    const chat = input.sessionOnly
      ? await getChatByEveSessionId(user.userId, chatSessionId(ctx))
      : null;
    const [documents, folders] = await Promise.all([
      input.sessionOnly
        ? chat
          ? listChatDocuments(user.userId, chat.id)
          : Promise.resolve([])
        : listDocuments(user.userId),
      listFolders(user.userId),
    ]);
    const inFolder =
      input.folderId === undefined
        ? documents
        : documents.filter((document) => (document.folderId ?? null) === input.folderId);
    const needle = query?.toLowerCase();
    const filtered = needle
      ? inFolder.filter(
          (document) =>
            document.title.toLowerCase().includes(needle) ||
            document.filename.toLowerCase().includes(needle),
        )
      : inFolder;
    return filtered.slice(0, 40).map((document) => toClientDocument(document, folders, user.userId));
  },
});
