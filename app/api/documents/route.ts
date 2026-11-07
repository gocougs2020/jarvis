import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/api";
import {
  DocumentError,
  createUserDocument,
  getDocumentLibrary,
  listUserDocuments,
  parseDocumentKind,
  searchUserLibrary,
  toClientDocument,
} from "@/lib/documents";
import { DocumentUploadError, assertDocumentByteLength, assertDocumentUpload } from "@/lib/document-upload";
import { listFolders } from "@/lib/store";
import { isResourceVisibility } from "@/lib/visibility";

export async function GET(request: Request) {
  const { session, error } = await requireApiSession(request);
  if (error || !session) return error;
  const params = new URL(request.url).searchParams;
  const chatId = params.get("chatId") ?? undefined;
  const query = params.get("q")?.trim().slice(0, 500) ?? "";
  const folderId = params.get("folderId");

  try {
    if (chatId) {
      return NextResponse.json({ documents: await listUserDocuments(session.user.id, chatId) });
    }
    if (query) {
      return NextResponse.json({ results: await searchUserLibrary(session.user.id, query) });
    }
    return NextResponse.json(await getDocumentLibrary(session.user.id, folderId));
  } catch (documentError) {
    if (documentError instanceof DocumentError) {
      return NextResponse.json({ error: documentError.message }, { status: documentError.status });
    }
    throw documentError;
  }
}

export async function POST(request: Request) {
  const { session, error } = await requireApiSession(request);
  if (error || !session) return error;

  try {
    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const file = form.get("file");
      const title = String(form.get("title") ?? (file instanceof File ? file.name : "")).trim();
      const filename = String(form.get("filename") ?? (file instanceof File ? file.name : "")).trim();
      const mimeType =
        String(form.get("mimeType") ?? (file instanceof File ? file.type : "")).trim() || undefined;
      const kind = parseDocumentKind(form.get("kind") || undefined);
      const chatId = String(form.get("chatId") ?? "").trim() || undefined;
      const folderId = parseOptionalFolderId(form.get("folderId"));
      const isPublic = form.get("isPublic") === "true";
      const visibilityValue = String(form.get("visibility") ?? "");
      if (file instanceof File) {
        assertDocumentUpload({ name: file.name, size: file.size, type: file.type });
      }
      const content =
        file instanceof File
          ? Buffer.from(await file.arrayBuffer())
          : String(form.get("content") ?? "");
      if (!(file instanceof File)) {
        assertDocumentByteLength(Buffer.byteLength(content));
      }
      const document = await createUserDocument(session.user.id, {
        chatId,
        content,
        filename: filename || undefined,
        folderId,
        isPublic,
        visibility: isResourceVisibility(visibilityValue) ? visibilityValue : undefined,
        kind,
        mimeType,
        title: title || filename || "Untitled",
      });
      const folders = await listFolders(session.user.id);
      return NextResponse.json({
        document: toClientDocument(document, folders),
      });
    }

    const body = (await request.json()) as {
      title?: string;
      content?: string;
      filename?: string;
      kind?: string;
      mimeType?: string;
      isPublic?: boolean;
      visibility?: string;
      chatId?: string;
      folderId?: string | null;
    };
    assertDocumentByteLength(Buffer.byteLength(body.content ?? ""));
    const document = await createUserDocument(session.user.id, {
      chatId: body.chatId,
      content: body.content ?? "",
      filename: body.filename,
      folderId: body.folderId,
      isPublic: body.isPublic,
      visibility: isResourceVisibility(body.visibility) ? body.visibility : undefined,
      kind: parseDocumentKind(body.kind),
      mimeType: body.mimeType,
      title: body.title ?? "Untitled",
    });
    const folders = await listFolders(session.user.id);
    return NextResponse.json({ document: toClientDocument(document, folders) });
  } catch (documentError) {
    if (documentError instanceof DocumentError || documentError instanceof DocumentUploadError) {
      return NextResponse.json({ error: documentError.message }, { status: documentError.status });
    }
    throw documentError;
  }
}

function parseOptionalFolderId(value: FormDataEntryValue | null): string | null | undefined {
  if (value == null || value === "") return undefined;
  return String(value);
}
