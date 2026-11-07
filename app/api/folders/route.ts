import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/api";
import {
  DocumentFolderError,
  createUserFolder,
  listUserFolders,
  toClientFolder,
} from "@/lib/document-folders";

export async function GET(request: Request) {
  const { session, error } = await requireApiSession(request);
  if (error || !session) return error;
  const folders = await listUserFolders(session.user.id);
  return NextResponse.json({
    folders: folders.map((folder) => toClientFolder(folder, folders, 0)),
  });
}

export async function POST(request: Request) {
  const { session, error } = await requireApiSession(request);
  if (error || !session) return error;
  const body = (await request.json()) as {
    name?: string;
    description?: string;
    parentId?: string | null;
  };

  try {
    const folder = await createUserFolder(session.user.id, {
      name: body.name ?? "",
      description: body.description,
      parentId: body.parentId,
    });
    const folders = await listUserFolders(session.user.id);
    return NextResponse.json({ folder: toClientFolder(folder, folders, 0) });
  } catch (folderError) {
    if (folderError instanceof DocumentFolderError) {
      return NextResponse.json({ error: folderError.message }, { status: folderError.status });
    }
    throw folderError;
  }
}
