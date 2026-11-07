import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { localEnvFilePath, upsertEnvFile } from "@/lib/setup-env-file";

describe("upsertEnvFile", () => {
  it("creates a file when none exists", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "jarvis-setup-"));
    const file = path.join(dir, ".env.local");
    upsertEnvFile(file, "BETTER_AUTH_SECRET", "abc123");
    expect(readFileSync(file, "utf8")).toBe("BETTER_AUTH_SECRET=abc123\n");
  });

  it("replaces an existing key and leaves other lines alone", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "jarvis-setup-"));
    const file = path.join(dir, ".env.local");
    writeFileSync(file, "AI_GATEWAY_API_KEY=keep\nBETTER_AUTH_SECRET=\n", "utf8");
    upsertEnvFile(file, "BETTER_AUTH_SECRET", "new-secret");
    expect(readFileSync(file, "utf8")).toBe(
      "AI_GATEWAY_API_KEY=keep\nBETTER_AUTH_SECRET=new-secret\n",
    );
  });

  it("appends when the key is missing", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "jarvis-setup-"));
    const file = path.join(dir, ".env.local");
    writeFileSync(file, "AI_GATEWAY_API_KEY=keep", "utf8");
    upsertEnvFile(file, "OWNER_EMAIL", "you@example.com");
    expect(readFileSync(file, "utf8")).toBe(
      "AI_GATEWAY_API_KEY=keep\nOWNER_EMAIL=you@example.com\n",
    );
  });
});

describe("localEnvFilePath", () => {
  it("points at .env.local in the project root", () => {
    expect(localEnvFilePath("/tmp/jarvis")).toBe(path.join("/tmp/jarvis", ".env.local"));
  });
});
