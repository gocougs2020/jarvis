import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/api";
import {
  DocumentError,
  deleteUserDocument,
  documentWithChats,
  parseDocumentKind,
  toClientDocument,
  updateUserDocument,
} from "@/lib/documents";
import { listFolders } from "@/lib/store";
import { isResourceVisibility } from "@/lib/visibility";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { session, error } = await requireApiSession(request);
  if (error || !session) return error;
  const { id } = await params;
  try {
    return NextResponse.json(await documentWithChats(session.user.id, id));
  } catch (documentError) {
    if (documentError instanceof DocumentError) {
      return NextResponse.json({ error: documentError.message }, { status: documentError.status });
    }
    throw documentError;
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { session, error } = await requireApiSession(request);
  if (error || !session) return error;
  const { id } = await params;
  const body = (await request.json()) as {
    title?: string;
    content?: string;
    filename?: string;
    kind?: string;
    mimeType?: string;
    isPublic?: boolean;
    visibility?: string;
    folderId?: string | null;
  };

  try {
    const document = await updateUserDocument(session.user.id, id, {
      content: body.content,
      filename: body.filename,
      folderId: body.folderId,
      isPublic: body.isPublic,
      visibility: isResourceVisibility(body.visibility) ? body.visibility : undefined,
      kind: parseDocumentKind(body.kind),
      mimeType: body.mimeType,
      title: body.title,
    });
    const folders = await listFolders(session.user.id);
    return NextResponse.json({ document: toClientDocument(document, folders) });
  } catch (documentError) {
    if (documentError instanceof DocumentError) {
      return NextResponse.json({ error: documentError.message }, { status: documentError.status });
    }
    throw documentError;
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { session, error } = await requireApiSession(request);
  if (error || !session) return error;
  const { id } = await params;
  try {
    await deleteUserDocument(session.user.id, id);
    return NextResponse.json({ ok: true });
  } catch (documentError) {
    if (documentError instanceof DocumentError) {
      return NextResponse.json({ error: documentError.message }, { status: documentError.status });
    }
    throw documentError;
  }
}
