import { randomUUID } from "node:crypto";
import { nanoid } from "nanoid";
import { deleteDocumentBlob, getDocumentBlob, putDocumentBlob } from "@/lib/blob-store";
import {
  DOCUMENT_SEARCH_MIN_SCORE,
  LIBRARY_EMBEDDING_KINDS,
  persistDocumentEmbeddings,
  removeDocumentEmbeddings,
} from "@/lib/document-embeddings";
import {
  folderAncestors,
  folderFileCounts,
  folderPathLabel,
  toClientFolder,
} from "@/lib/document-folders";
import {
  filenameForDocument,
  safeFilename,
  inferDocumentKind,
  isDocumentKind,
  isEditableDocumentKind,
  isTextDocumentKind,
  storedMimeType,
} from "@/lib/document-kind";
import { DOCUMENT_TOO_LARGE_MESSAGE, MAX_DOCUMENT_BYTES } from "@/lib/document-upload";
import { embedTexts } from "@/lib/embeddings";
import {
  attachDocument,
  createDocument,
  deleteDocument,
  getChatByEveSessionId,
  getDocument,
  getFolder,
  getPublicDocument,
  listChatDocuments,
  listDocumentChats,
  listDocuments,
  listFolders,
  searchUserEmbeddings,
  updateDocument,
} from "@/lib/store";
import { runWithUsageScope } from "@/lib/usage-scope";
import type {
  ClientDocument,
  ClientFolder,
  DocumentFolder,
  DocumentKind,
  DocumentRecord,
  DocumentSearchHit,
  DocumentSearchMatch,
} from "@/lib/types";
import { isPublicVisibility, resolveFileVisibility, type ResourceVisibility } from "@/lib/visibility";

export class DocumentError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "DocumentError";
  }
}

export function toClientDocument(
  document: DocumentRecord,
  folders: readonly DocumentFolder[] = [],
): ClientDocument {
  return {
    id: document.id,
    userId: document.userId,
    folderId: document.folderId ?? null,
    title: document.title,
    filename: document.filename,
    kind: document.kind,
    mimeType: document.mimeType,
    size: document.size,
    isPublic: document.isPublic,
    shareId: document.shareId,
    visibility: document.visibility,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
    href: `/files/${document.id}`,
    fileHref: `/api/documents/${document.id}/file`,
    shareUrl: document.isPublic ? `/d/${document.shareId}` : null,
    editable: isEditableDocumentKind(document.kind),
    folderPath: folderPathLabel(folders, document.folderId),
  };
}

export function publicFileHref(shareId: string): string {
  return `/d/${shareId}/file`;
}

function nowIso() {
  return new Date().toISOString();
}

function asBuffer(content: Buffer | Uint8Array | string): Buffer {
  return typeof content === "string" ? Buffer.from(content) : Buffer.from(content);
}

export async function createUserDocument(
  userId: string,
  input: {
    title: string;
    content: Buffer | Uint8Array | string;
    filename?: string;
    kind?: DocumentKind;
    mimeType?: string;
    isPublic?: boolean;
    visibility?: ResourceVisibility;
    folderId?: string | null;
    chatId?: string;
    eveSessionId?: string;
  },
): Promise<DocumentRecord> {
  const title = input.title.trim();
  if (!title) throw new DocumentError("A document title is required.");

  const kind = input.kind ?? inferDocumentKind(input.filename ?? title, input.mimeType);
  const filename = filenameForDocument(title, kind, input.filename);
  const mimeType = storedMimeType(filename, kind, input.mimeType);
  const buffer = asBuffer(input.content);
  if (buffer.byteLength > MAX_DOCUMENT_BYTES) {
    throw new DocumentError(DOCUMENT_TOO_LARGE_MESSAGE, 413);
  }
  const id = randomUUID();
  const pathname = `documents/${userId}/${id}/${filename}`;
  const stored = await putDocumentBlob(pathname, buffer, mimeType);
  const folderId = await resolveFolderId(userId, input.folderId);
  const stamp = nowIso();
  const visibility = resolveFileVisibility({
    isPublic: input.isPublic,
    visibility: input.visibility,
  });

  const document = await createDocument({
    id,
    userId,
    folderId,
    title,
    filename,
    kind,
    mimeType,
    blobPathname: stored.pathname,
    blobUrl: stored.url,
    size: buffer.byteLength,
    isPublic: isPublicVisibility(visibility),
    visibility,
    shareId: nanoid(12),
    createdAt: stamp,
    updatedAt: stamp,
  });

  const chatId =
    input.chatId ??
    (input.eveSessionId
      ? (await getChatByEveSessionId(userId, input.eveSessionId))?.id
      : undefined);
  if (chatId) {
    await attachDocument(userId, document.id, chatId);
  }

  const contentText = isTextDocumentKind(kind) ? buffer.toString("utf8") : "";
  void persistDocumentEmbeddings(document, { content: contentText });

  return document;
}

export async function updateUserDocument(
  userId: string,
  documentId: string,
  patch: {
    title?: string;
    content?: Buffer | Uint8Array | string;
    filename?: string;
    kind?: DocumentKind;
    mimeType?: string;
    isPublic?: boolean;
    visibility?: ResourceVisibility;
    folderId?: string | null;
  },
): Promise<DocumentRecord> {
  const current = await getDocument(userId, documentId);
  if (!current) throw new DocumentError("Document not found.", 404);
  const changingShare = patch.visibility !== undefined || patch.isPublic !== undefined;
  const visibility = changingShare
    ? resolveFileVisibility({
        currentVisibility: current.visibility,
        isPublic: patch.isPublic,
        visibility: patch.visibility,
      })
    : current.visibility;

  const title = patch.title?.trim() || current.title;
  const kind = patch.kind ?? current.kind;
  const filename = (patch.filename ? safeFilename(patch.filename) : "") || current.filename;
  const mimeType = storedMimeType(filename, kind, patch.mimeType?.trim() || current.mimeType);
  let blobPathname = current.blobPathname;
  let blobUrl = current.blobUrl;
  let size = current.size;

  if (patch.content !== undefined) {
    const buffer = asBuffer(patch.content);
    const stored = await putDocumentBlob(current.blobPathname, buffer, mimeType);
    blobPathname = stored.pathname;
    blobUrl = stored.url;
    size = buffer.byteLength;
  }

  const next = await updateDocument(userId, documentId, {
    title,
    filename,
    kind,
    mimeType,
    blobPathname,
    blobUrl,
    size,
    isPublic: isPublicVisibility(visibility),
    visibility,
    folderId:
      patch.folderId === undefined ? current.folderId : await resolveFolderId(userId, patch.folderId),
  });
  if (!next) throw new DocumentError("Document not found.", 404);
  const contentChanged = patch.content !== undefined;
  const titleChanged = Boolean(patch.title && patch.title.trim() !== current.title);
  if (contentChanged || titleChanged) {
    const contentText = contentChanged
      ? isTextDocumentKind(next.kind)
        ? asBuffer(patch.content ?? "").toString("utf8")
        : ""
      : undefined;
    void persistDocumentEmbeddings(next, {
      content: contentText,
      titleOnly: !contentChanged,
    });
  }
  return next;
}

export async function deleteUserDocument(userId: string, documentId: string): Promise<void> {
  const current = await getDocument(userId, documentId);
  if (!current) throw new DocumentError("Document not found.", 404);
  const document = await deleteDocument(userId, documentId);
  if (!document) throw new DocumentError("Document not found.", 404);
  await Promise.all([
    deleteDocumentBlob(document.blobUrl, document.blobPathname),
    removeDocumentEmbeddings(userId, documentId),
  ]);
}

export async function readDocumentBytes(
  document: DocumentRecord,
): Promise<{ buffer: Buffer; contentType: string }> {
  const stored = await getDocumentBlob(document.blobUrl, document.blobPathname);
  if (!stored) throw new DocumentError("Document file is missing.", 404);
  return { buffer: stored.buffer, contentType: stored.contentType ?? document.mimeType };
}

export async function readDocumentText(document: DocumentRecord): Promise<string> {
  if (!isTextDocumentKind(document.kind)) {
    throw new DocumentError("This document is not a text file.");
  }
  const { buffer } = await readDocumentBytes(document);
  return buffer.toString("utf8");
}

export async function listUserDocuments(userId: string, chatId?: string) {
  const [documents, folders] = await Promise.all([
    chatId ? listChatDocuments(userId, chatId) : listDocuments(userId),
    listFolders(userId),
  ]);
  return documents.map((document) => toClientDocument(document, folders));
}

export type DocumentLibrary = {
  folder: ClientFolder | null;
  ancestors: ClientFolder[];
  folders: ClientFolder[];
  documents: ClientDocument[];
};

export async function getDocumentLibrary(
  userId: string,
  folderId?: string | null,
): Promise<DocumentLibrary> {
  const [folders, documents] = await Promise.all([listFolders(userId), listDocuments(userId)]);
  const current =
    folderId && folderId.length > 0
      ? (folders.find((folder) => folder.id === folderId) ?? null)
      : null;
  if (folderId && !current) throw new DocumentError("Folder not found.", 404);

  const visibleFolderIds = new Set(folders.map((folder) => folder.id));
  const displayFolderId = (document: DocumentRecord) =>
    document.folderId && visibleFolderIds.has(document.folderId) ? document.folderId : null;
  const childFolders = folders
    .filter((folder) => folder.parentId === (current?.id ?? null))
    .sort((left, right) => left.name.localeCompare(right.name));
  const visibleDocuments = documents.filter(
    (document) => displayFolderId(document) === (current?.id ?? null),
  );
  const fileCounts = folderFileCounts(folders, documents);
  const asClientFolder = (folder: DocumentFolder) =>
    toClientFolder(folder, folders, fileCounts.get(folder.id) ?? 0);

  return {
    folder: current ? asClientFolder(current) : null,
    ancestors: folderAncestors(folders, current?.parentId ?? null).map(asClientFolder),
    folders: childFolders.map(asClientFolder),
    documents: visibleDocuments.map((document) => toClientDocument(document, folders)),
  };
}

export async function searchUserLibrary(
  userId: string,
  query: string,
  limit = 40,
): Promise<DocumentSearchHit[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const [documents, folders] = await Promise.all([listDocuments(userId), listFolders(userId)]);
  const fileCounts = folderFileCounts(folders, documents);
  const asClientFolder = (folder: DocumentFolder) =>
    toClientFolder(folder, folders, fileCounts.get(folder.id) ?? 0);
  const needle = trimmed.toLowerCase();
  const hits = new Map<string, DocumentSearchHit>();

  const remember = (hit: DocumentSearchHit, key: string) => {
    const existing = hits.get(key);
    if (!existing || hit.score > existing.score) hits.set(key, hit);
  };

  for (const document of documents) {
    const title = document.title.toLowerCase();
    const filename = document.filename.toLowerCase();
    let score = 0;
    if (title === needle || filename === needle) score = 1;
    else if (title.includes(needle)) score = 0.92;
    else if (filename.includes(needle)) score = 0.86;
    if (score > 0) {
      remember(
        {
          type: "document",
          score,
          match: "name",
          document: toClientDocument(document, folders),
        },
        `document:${document.id}`,
      );
    }
  }

  for (const folder of folders) {
    const name = folder.name.toLowerCase();
    const description = folder.description.toLowerCase();
    let score = 0;
    if (name === needle) score = 0.98;
    else if (name.includes(needle)) score = 0.88;
    else if (description.includes(needle)) score = 0.72;
    if (score > 0) {
      remember(
        {
          type: "folder",
          score,
          match: "name",
          folder: asClientFolder(folder),
        },
        `folder:${folder.id}`,
      );
    }
  }

  try {
    const [embedding] = await runWithUsageScope({ userId }, () => embedTexts([trimmed]));
    if (embedding) {
      const semantic = await searchUserEmbeddings({
        userId,
        queryEmbeddings: [embedding],
        kinds: LIBRARY_EMBEDDING_KINDS,
        limit: Math.max(limit * 2, 24),
        minScore: DOCUMENT_SEARCH_MIN_SCORE,
      });
      for (const hit of semantic) {
        const match: DocumentSearchMatch =
          hit.record.kind === "document_content" || hit.record.kind === "folder_description"
            ? "content"
            : "similar";
        if (hit.record.sourceType === "folder") {
          const folder = folders.find((row) => row.id === hit.record.sourceId);
          if (!folder) continue;
          remember(
            {
              type: "folder",
              score: hit.score,
              match,
              folder: asClientFolder(folder),
            },
            `folder:${folder.id}`,
          );
          continue;
        }
        const document = documents.find((row) => row.id === hit.record.sourceId);
        if (!document) continue;
        remember(
          {
            type: "document",
            score: hit.score,
            match,
            document: toClientDocument(document, folders),
          },
          `document:${document.id}`,
        );
      }
    }
  } catch (error) {
    console.error("[documents] search embedding failed", error);
  }

  return [...hits.values()].sort((left, right) => right.score - left.score).slice(0, limit);
}

export async function getUserDocument(userId: string, documentId: string) {
  const document = await getDocument(userId, documentId);
  if (!document) throw new DocumentError("Document not found.", 404);
  return document;
}

export async function getSharedDocument(shareId: string) {
  const document = await getPublicDocument(shareId);
  if (!document) throw new DocumentError("Document not found.", 404);
  return document;
}

export async function documentWithChats(userId: string, documentId: string) {
  const document = await getUserDocument(userId, documentId);
  const [chats, folders] = await Promise.all([
    listDocumentChats(userId, documentId),
    listFolders(userId),
  ]);
  return { document: toClientDocument(document, folders), chats };
}

async function resolveFolderId(userId: string, folderId?: string | null): Promise<string | null> {
  if (folderId == null || folderId === "") return null;
  const folder = await getFolder(userId, folderId);
  if (!folder) throw new DocumentError("Folder not found.", 404);
  return folder.id;
}

export function parseDocumentKind(value: unknown): DocumentKind | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (!isDocumentKind(value)) throw new DocumentError("Unsupported document kind.");
  return value;
}
