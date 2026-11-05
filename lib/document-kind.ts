import type { DocumentKind } from "@/lib/types";

const kindExtensions: Record<DocumentKind, string> = {
  markdown: "md",
  html: "html",
  text: "txt",
  csv: "csv",
  json: "json",
  image: "png",
  pdf: "pdf",
  other: "bin",
};

const kindLabels: Record<DocumentKind, string> = {
  markdown: "Markdown",
  html: "HTML",
  text: "Text",
  csv: "CSV",
  json: "JSON",
  image: "Image",
  pdf: "PDF",
  other: "File",
};

const kindMimeTypes: Record<DocumentKind, string> = {
  markdown: "text/markdown",
  html: "text/html",
  text: "text/plain",
  csv: "text/csv",
  json: "application/json",
  image: "image/png",
  pdf: "application/pdf",
  other: "application/octet-stream",
};

export function documentKindLabel(kind: DocumentKind): string {
  return kindLabels[kind];
}

export function isTextDocumentKind(kind: DocumentKind): boolean {
  return kind === "markdown" || kind === "html" || kind === "text" || kind === "csv" || kind === "json";
}

export function isEditableDocumentKind(kind: DocumentKind): boolean {
  return isTextDocumentKind(kind);
}

export function defaultMimeTypeForKind(kind: DocumentKind): string {
  return kindMimeTypes[kind];
}

export function storedMimeType(
  filename: string,
  kind: DocumentKind,
  mimeType?: string,
): string {
  const raw = mimeType?.trim() || defaultMimeTypeForKind(kind);
  return isSvgFilenameOrMime(filename, raw) ? "application/octet-stream" : raw;
}

function isSvgFilenameOrMime(filename: string, mimeType?: string): boolean {
  const extension = filename.split(".").pop()?.toLowerCase() ?? "";
  const mime = mimeType?.split(";")[0]?.trim().toLowerCase() ?? "";
  return extension === "svg" || mime === "image/svg+xml";
}

export function extensionForKind(kind: DocumentKind): string {
  return kindExtensions[kind];
}

export function inferDocumentKind(filename: string, mimeType?: string): DocumentKind {
  const extension = filename.split(".").pop()?.toLowerCase() ?? "";
  const mime = mimeType?.split(";")[0]?.trim().toLowerCase() ?? "";

  if (extension === "svg" || mime === "image/svg+xml") return "other";
  if (mime.startsWith("image/") || ["png", "jpg", "jpeg", "gif", "webp", "avif"].includes(extension)) {
    return "image";
  }
  if (mime === "application/pdf" || extension === "pdf") return "pdf";
  if (mime.includes("markdown") || extension === "md" || extension === "markdown") return "markdown";
  if (mime === "text/html" || extension === "html" || extension === "htm") return "html";
  if (mime === "text/csv" || extension === "csv") return "csv";
  if (mime === "application/json" || extension === "json") return "json";
  if (mime.startsWith("text/") || ["txt", "text"].includes(extension)) return "text";
  return "other";
}

/**
 * Reduce a client- or model-supplied filename to one safe path segment:
 * no directories, no `..`, no control or reserved characters.
 */
export function safeFilename(value: string): string {
  const base = value.split(/[\\/]/).pop() ?? "";
  return base
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "")
    .replace(/^\.+/, "")
    .trim()
    .slice(0, 160);
}

export function filenameForDocument(title: string, kind: DocumentKind, existing?: string): string {
  const provided = existing ? safeFilename(existing) : "";
  if (provided) return provided;
  const slug = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return `${slug || "document"}.${extensionForKind(kind)}`;
}

export function isDocumentKind(value: unknown): value is DocumentKind {
  return (
    value === "markdown" ||
    value === "html" ||
    value === "text" ||
    value === "csv" ||
    value === "json" ||
    value === "image" ||
    value === "pdf" ||
    value === "other"
  );
}
