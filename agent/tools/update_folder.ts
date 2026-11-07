import { defineTool } from "eve/tools";
import { z } from "zod";
import { requireUser } from "../lib/identity";
import { listUserFolders, toClientFolder, updateUserFolder } from "../../lib/document-folders";

export default defineTool({
  description:
    "Rename a folder, update its description, or move it under another folder in the file library.",
  inputSchema: z.object({
    id: z.string().min(1),
    name: z.string().min(1).optional(),
    description: z.string().optional(),
    parentId: z
      .string()
      .nullable()
      .optional()
      .describe("Destination folder id, or null to move the folder to the library root."),
  }),
  async execute(input, ctx) {
    const user = requireUser(ctx);
    const folder = await updateUserFolder(user.userId, input.id, {
      name: input.name,
      description: input.description,
      parentId: input.parentId,
    });
    const folders = await listUserFolders(user.userId);
    return toClientFolder(folder, folders, 0);
  },
});
