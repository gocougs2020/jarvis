import path from "node:path";
import { describe, expect, it } from "vitest";
import { localPath } from "@/lib/blob-store";
import { filenameForDocument, safeFilename } from "@/lib/document-kind";

describe("safeFilename", () => {
  it("keeps only the last path segment", () => {
    expect(safeFilename("../../../../.env.local")).toBe("env.local");
    expect(safeFilename("..\\..\\boot.ini")).toBe("boot.ini");
    expect(safeFilename("reports/q3 plan.pdf")).toBe("q3 plan.pdf");
  });

  it("drops control and reserved characters", () => {
    expect(safeFilename('a\r\nb<c>"d".txt')).toBe("abcd.txt");
  });

  it("falls back to a title slug when nothing usable remains", () => {
    expect(filenameForDocument("Weekly Plan", "markdown", "../..")).toBe("weekly-plan.md");
  });
});

describe("localPath", () => {
  it("stays under .data/blobs", () => {
    expect(localPath("documents/u/1/a.md")).toBe(
      path.resolve(process.cwd(), ".data", "blobs", "documents/u/1/a.md"),
    );
    expect(() => localPath("documents/u/1/../../../../.env.local")).toThrow();
  });
});
