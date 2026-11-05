import { DocumentError, getSharedDocument, readDocumentBytes } from "@/lib/documents";
import { downloadSafeContentType, userFileHeaders } from "@/lib/http-file";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ shareId: string }> },
) {
  const { shareId } = await params;
  try {
    const document = await getSharedDocument(shareId);
    const { buffer, contentType: storedType } = await readDocumentBytes(document);
    const download = new URL(request.url).searchParams.get("download") === "1";
    const contentType = downloadSafeContentType(storedType);
    return new Response(new Uint8Array(buffer), {
      headers: userFileHeaders({
        filename: document.filename,
        contentType,
        download,
        cacheControl: "public, max-age=60",
      }),
    });
  } catch (documentError) {
    if (documentError instanceof DocumentError) {
      return Response.json({ error: documentError.message }, { status: documentError.status });
    }
    throw documentError;
  }
}
