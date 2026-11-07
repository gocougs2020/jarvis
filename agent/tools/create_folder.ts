import { defineTool } from "eve/tools";
import { z } from "zod";
import { requireUser } from "../lib/identity";
import { createUserFolder, listUserFolders, toClientFolder } from "../../lib/document-folders";

export default defineTool({
  description:
    "Create a folder in the user's file library. Use to organize files. Description helps later search understand what belongs in the folder.",
  inputSchema: z.object({
    name: z.string().min(1).describe("Folder name shown in the library."),
    description: z
      .string()
      .optional()
      .describe("Optional note about the kinds of files that belong here."),
    parentId: z.string().optional().describe("Existing folder id to nest under. Omit for the root."),
  }),
  async execute(input, ctx) {
    const user = requireUser(ctx);
    const folder = await createUserFolder(user.userId, {
      name: input.name,
      description: input.description,
      parentId: input.parentId,
    });
    const folders = await listUserFolders(user.userId);
    return toClientFolder(folder, folders, 0);
  },
});
