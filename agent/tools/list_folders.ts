import { defineTool } from "eve/tools";
import { z } from "zod";
import { requireUser } from "../lib/identity";
import { listUserFolders, toClientFolder } from "../../lib/document-folders";

export default defineTool({
  description:
    "List the user's folders.",
  inputSchema: z.object({
    parentId: z
      .string()
      .nullable()
      .optional()
      .describe("If set, only folders directly inside this folder. Null lists root folders."),
  }),
  async execute(input, ctx) {
    const user = requireUser(ctx);
    const folders = await listUserFolders(user.userId);
    const filtered =
      input.parentId === undefined
        ? folders
        : folders.filter((folder) => folder.parentId === input.parentId);
    return filtered.map((folder) => toClientFolder(folder, folders, 0));
  },
});
