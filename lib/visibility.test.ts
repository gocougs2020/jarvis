import { describe, expect, it } from "vitest";
import {
  isOwnedBy,
  normalizeLibraryVisibility,
  parseVisibility,
  resolveFileVisibility,
} from "@/lib/visibility";

describe("parseVisibility", () => {
  it("accepts private and public", () => {
    expect(parseVisibility("private")).toBe("private");
    expect(parseVisibility("public")).toBe("public");
  });

  it("reads the old multi-user values as private, never more visible", () => {
    expect(parseVisibility("shared")).toBe("private");
    expect(parseVisibility("account")).toBe("private");
  });

  it("rejects anything else", () => {
    expect(parseVisibility("everyone")).toBeUndefined();
    expect(parseVisibility(undefined)).toBeUndefined();
  });
});

describe("normalizeLibraryVisibility", () => {
  it("is public only for public rows or the is_public flag", () => {
    expect(normalizeLibraryVisibility("public")).toBe("public");
    expect(normalizeLibraryVisibility("private", true)).toBe("public");
    expect(normalizeLibraryVisibility("shared")).toBe("private");
    expect(normalizeLibraryVisibility("account")).toBe("private");
    expect(normalizeLibraryVisibility(undefined)).toBe("private");
  });
});

describe("resolveFileVisibility", () => {
  it("lets isPublic decide when it is given", () => {
    expect(resolveFileVisibility({ isPublic: true })).toBe("public");
    expect(resolveFileVisibility({ visibility: "private", isPublic: true })).toBe("public");
    expect(resolveFileVisibility({ visibility: "public", isPublic: false })).toBe("private");
    expect(resolveFileVisibility({ isPublic: false, currentVisibility: "public" })).toBe("private");
  });

  it("otherwise uses the requested visibility, then the current one", () => {
    expect(resolveFileVisibility({ visibility: "public" })).toBe("public");
    expect(resolveFileVisibility({ visibility: "shared" })).toBe("private");
    expect(resolveFileVisibility({ currentVisibility: "public" })).toBe("public");
    expect(resolveFileVisibility({})).toBe("private");
  });
});

describe("isOwnedBy", () => {
  it("matches only the record's user", () => {
    expect(isOwnedBy({ userId: "user-1" }, "user-1")).toBe(true);
    expect(isOwnedBy({ userId: "user-1" }, "user-2")).toBe(false);
  });
});
