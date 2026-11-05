import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { del, get, put } from "@vercel/blob";

export function hasBlobStore(): boolean {
  return Boolean(
    process.env.BLOB_READ_WRITE_TOKEN ||
      process.env.BLOB_STORE_ID ||
      process.env.VERCEL_BLOB_STORE_ID,
  );
}

const LOCAL_BLOB_ROOT = path.resolve(process.cwd(), ".data", "blobs");

/** Resolve a blob pathname under `.data/blobs`, refusing anything that escapes it. */
export function localPath(pathname: string): string {
  const resolved = path.resolve(LOCAL_BLOB_ROOT, pathname);
  if (!resolved.startsWith(`${LOCAL_BLOB_ROOT}${path.sep}`)) {
    throw new Error("Invalid file path.");
  }
  return resolved;
}

function remoteBlobAuth(): { token?: string } {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  const env = process.env.VERCEL_ENV;
  // An explicit token always beats OIDC. Local `next dev` often has
  // BLOB_STORE_ID plus an auto-issued OIDC token, and put() then fails with
  // "OIDC is enabled … but not for the development environment" unless the
  // store's project connection includes Development.
  if (token && env !== "production" && env !== "preview") {
    return { token };
  }
  return {};
}

export async function putDocumentBlob(
  pathname: string,
  body: Buffer | Uint8Array | Blob | File | string,
  contentType: string,
): Promise<{ pathname: string; url: string }> {
  if (hasBlobStore()) {
    const payload =
      typeof body === "string" || body instanceof Blob || Buffer.isBuffer(body)
        ? body
        : Buffer.from(body);
    const result = await put(pathname, payload, {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType,
      ...remoteBlobAuth(),
    });
    return { pathname: result.pathname, url: result.url };
  }

  const filePath = localPath(pathname);
  mkdirSync(path.dirname(filePath), { recursive: true });
  if (typeof body === "string") {
    writeFileSync(filePath, body);
  } else if (body instanceof Blob) {
    writeFileSync(filePath, Buffer.from(await body.arrayBuffer()));
  } else {
    writeFileSync(filePath, Buffer.from(body));
  }
  return { pathname, url: `local:${pathname}` };
}

export async function getDocumentBlob(
  url: string,
  pathname: string,
): Promise<{ buffer: Buffer; contentType?: string } | null> {
  if (url.startsWith("local:")) {
    try {
      return { buffer: readFileSync(localPath(pathname)) };
    } catch {
      return null;
    }
  }

  const result = await get(url, { access: "private", useCache: false, ...remoteBlobAuth() });
  if (!result || result.statusCode !== 200 || !result.stream) {
    return null;
  }
  const buffer = Buffer.from(await new Response(result.stream).arrayBuffer());
  return { buffer, contentType: result.blob.contentType };
}

export async function deleteDocumentBlob(url: string, pathname: string): Promise<void> {
  if (url.startsWith("local:")) {
    rmSync(localPath(pathname), { force: true });
    return;
  }
  await del(url, remoteBlobAuth());
}
