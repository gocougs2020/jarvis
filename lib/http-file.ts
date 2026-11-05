/**
 * Types a browser can show inline without running script on our origin.
 * Anything else (HTML, SVG, XML, XSL, …) is served as an octet-stream
 * download. An allowlist, not a denylist: browsers treat a long tail of types
 * (text/xsl, application/rss+xml, …) as script-capable documents.
 */
const INLINE_SAFE_MIME = new Set([
  "application/json",
  "application/pdf",
  "image/avif",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
  "text/csv",
  "text/markdown",
  "text/plain",
]);

export function downloadSafeContentType(mimeType: string | undefined): string {
  const mime =
    (mimeType ?? "application/octet-stream").split(";")[0]?.trim().toLowerCase() ||
    "application/octet-stream";
  return INLINE_SAFE_MIME.has(mime) ? mime : "application/octet-stream";
}

/**
 * Headers for a user file served from this origin. The sandbox CSP stops a
 * file from running script or reading app cookies even if a browser sniffs it
 * as a document. PDFs skip `sandbox` because Chromium's viewer refuses to
 * render inside a sandboxed document.
 */
export function userFileHeaders(input: {
  filename: string;
  contentType: string;
  download: boolean;
  cacheControl: string;
}): Record<string, string> {
  const forceDownload = input.download || input.contentType === "application/octet-stream";
  return {
    "Content-Disposition": fileContentDisposition(input.filename, forceDownload),
    "Content-Type": input.contentType,
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": input.cacheControl,
    ...(input.contentType === "application/pdf"
      ? {}
      : { "Content-Security-Policy": "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'" }),
  };
}

export function fileContentDisposition(filename: string, download: boolean): string {
  const mode = download ? "attachment" : "inline";
  const fallback = asciiFilename(filename);
  const encoded = encodeRFC5987(filename);
  return `${mode}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

function asciiFilename(value: string): string {
  const base =
    value.replace(/[\r\n\\/"]/g, "").replace(/[^\x20-\x7E]/g, "_").trim() || "download";
  return base.slice(0, 120);
}

function encodeRFC5987(value: string): string {
  return encodeURIComponent(value.normalize("NFC"))
    .replace(/['()]/g, escape)
    .replace(/\*/g, "%2A");
}
