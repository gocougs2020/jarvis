import { randomUUID } from "node:crypto";
import { persistFolderEmbeddings } from "@/lib/document-embeddings";
import {
  createFolder,
  deleteEmbeddingsForSource,
  deleteFolder,
  getFolder,
  listFolders,
  updateFolder,
} from "@/lib/store";
import type { ClientFolder, DocumentFolder, DocumentRecord } from "@/lib/types";

export function folderHref(folderId?: string | null): string {
  return folderId ? `/files?folder=${folderId}` : "/files";
}

export function folderAncestors(
  folders: readonly DocumentFolder[],
  folderId: string | null | undefined,
): DocumentFolder[] {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const path: DocumentFolder[] = [];
  const seen = new Set<string>();
  let current = folderId ? byId.get(folderId) : undefined;
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    path.unshift(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return path;
}

export function folderPathLabel(
  folders: readonly DocumentFolder[],
  folderId: string | null | undefined,
): string {
  return folderAncestors(folders, folderId)
    .map((folder) => folder.name)
    .join(" / ");
}

export function folderFileCounts(
  folders: readonly DocumentFolder[],
  documents: readonly Pick<DocumentRecord, "folderId">[],
): Map<string, number> {
  const children = new Map<string | null, string[]>();
  for (const folder of folders) {
    const siblings = children.get(folder.parentId) ?? [];
    siblings.push(folder.id);
    children.set(folder.parentId, siblings);
  }

  const direct = new Map<string, number>();
  for (const document of documents) {
    if (!document.folderId) continue;
    direct.set(document.folderId, (direct.get(document.folderId) ?? 0) + 1);
  }

  const totals = new Map<string, number>();
  const visit = (folderId: string): number => {
    const cached = totals.get(folderId);
    if (cached !== undefined) return cached;
    totals.set(folderId, 0);
    const nested = (children.get(folderId) ?? []).reduce((sum, childId) => sum + visit(childId), 0);
    const total = (direct.get(folderId) ?? 0) + nested;
    totals.set(folderId, total);
    return total;
  };

  for (const folder of folders) visit(folder.id);
  return totals;
}

export function toClientFolder(
  folder: DocumentFolder,
  folders: readonly DocumentFolder[] = [],
  fileCount = 0,
): ClientFolder {
  const ancestors = folderAncestors(folders, folder.parentId);
  return {
    id: folder.id,
    parentId: folder.parentId,
    name: folder.name,
    description: folder.description,
    createdAt: folder.createdAt,
    updatedAt: folder.updatedAt,
    href: folderHref(folder.id),
    path: [...ancestors, folder].map((item) => item.name).join(" / "),
    fileCount,
  };
}

export function wouldCreateFolderCycle(
  folders: readonly DocumentFolder[],
  folderId: string,
  nextParentId: string | null,
): boolean {
  if (!nextParentId) return false;
  if (nextParentId === folderId) return true;
  return folderAncestors(folders, nextParentId).some((folder) => folder.id === folderId);
}

function nowIso() {
  return new Date().toISOString();
}

export async function listUserFolders(userId: string): Promise<DocumentFolder[]> {
  return listFolders(userId);
}

export async function getUserFolder(userId: string, folderId: string) {
  return getFolder(userId, folderId);
}

export async function createUserFolder(
  userId: string,
  input: {
    name: string;
    description?: string;
    parentId?: string | null;
  },
): Promise<DocumentFolder> {
  const name = input.name.trim();
  if (!name) throw new DocumentFolderError("A folder name is required.");

  const parentId = input.parentId?.trim() || null;
  if (parentId) {
    const parent = await getFolder(userId, parentId);
    if (!parent) throw new DocumentFolderError("Folder not found.", 404);
  }

  const stamp = nowIso();
  const folder = await createFolder({
    id: randomUUID(),
    userId,
    parentId,
    name,
    description: input.description?.trim() ?? "",
    visibility: "private",
    createdAt: stamp,
    updatedAt: stamp,
  });
  void persistFolderEmbeddings(folder);
  return folder;
}

export async function updateUserFolder(
  userId: string,
  folderId: string,
  patch: {
    name?: string;
    description?: string;
    parentId?: string | null;
  },
): Promise<DocumentFolder> {
  const current = await getFolder(userId, folderId);
  if (!current) throw new DocumentFolderError("Folder not found.", 404);

  const nextParentId = patch.parentId === undefined ? current.parentId : patch.parentId;
  if (nextParentId) {
    const parent = await getFolder(userId, nextParentId);
    if (!parent) throw new DocumentFolderError("Folder not found.", 404);
  }
  const folders = await listFolders(userId);
  if (wouldCreateFolderCycle(folders, folderId, nextParentId)) {
    throw new DocumentFolderError("A folder cannot be moved into itself.");
  }

  const next = await updateFolder(userId, folderId, {
    name: patch.name?.trim() || current.name,
    description: patch.description === undefined ? current.description : patch.description.trim(),
    parentId: nextParentId,
  });
  if (!next) throw new DocumentFolderError("Folder not found.", 404);
  if (patch.name !== undefined || patch.description !== undefined) {
    void persistFolderEmbeddings(next);
  }
  return next;
}

export async function deleteUserFolder(userId: string, folderId: string): Promise<void> {
  const current = await getFolder(userId, folderId);
  if (!current) throw new DocumentFolderError("Folder not found.", 404);
  const folder = await deleteFolder(userId, folderId);
  if (!folder) throw new DocumentFolderError("Folder not found.", 404);
  await deleteEmbeddingsForSource(userId, "folder", folderId);
}

export class DocumentFolderError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "DocumentFolderError";
  }
}
