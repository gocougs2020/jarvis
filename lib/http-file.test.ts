import { describe, expect, it } from "vitest";
import { downloadSafeContentType, fileContentDisposition, userFileHeaders } from "@/lib/http-file";

describe("downloadSafeContentType", () => {
  it("rewrites executable MIME types to octet-stream", () => {
    expect(downloadSafeContentType("text/html")).toBe("application/octet-stream");
    expect(downloadSafeContentType("application/xhtml+xml")).toBe("application/octet-stream");
    expect(downloadSafeContentType("image/svg+xml")).toBe("application/octet-stream");
    expect(downloadSafeContentType("application/rdf+xml")).toBe("application/octet-stream");
    expect(downloadSafeContentType("image/png")).toBe("image/png");
  });

  it("downloads anything not on the inline allowlist", () => {
    expect(downloadSafeContentType("text/xsl")).toBe("application/octet-stream");
    expect(downloadSafeContentType("application/x-whatever")).toBe("application/octet-stream");
    expect(downloadSafeContentType(undefined)).toBe("application/octet-stream");
    expect(downloadSafeContentType("text/plain; charset=utf-8")).toBe("text/plain");
    expect(downloadSafeContentType("application/pdf")).toBe("application/pdf");
  });
});

describe("fileContentDisposition", () => {
  it("strips CR and LF from a hostile filename", () => {
    const header = fileContentDisposition('evil\r\nfilename="hacked.exe"', true);
    expect(header).not.toMatch(/[\r\n]/);
    expect(header.startsWith("attachment;")).toBe(true);
  });
});

describe("userFileHeaders", () => {
  it("sandboxes inline files and forces octet-stream to download", () => {
    const png = userFileHeaders({
      filename: "a.png",
      contentType: "image/png",
      download: false,
      cacheControl: "no-store",
    });
    expect(png["Content-Disposition"].startsWith("inline;")).toBe(true);
    expect(png["Content-Security-Policy"]).toMatch(/^sandbox;/);
    const blob = userFileHeaders({
      filename: "a.xsl",
      contentType: "application/octet-stream",
      download: false,
      cacheControl: "no-store",
    });
    expect(blob["Content-Disposition"].startsWith("attachment;")).toBe(true);
  });
});
