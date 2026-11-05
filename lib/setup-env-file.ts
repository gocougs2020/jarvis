import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export const SETUP_ENV_WRITABLE_KEYS = ["BETTER_AUTH_SECRET", "ALLOWED_SIGNUP_EMAILS"] as const;

export type SetupEnvWritableKey = (typeof SETUP_ENV_WRITABLE_KEYS)[number];

function isWritableKey(key: string): key is SetupEnvWritableKey {
  return (SETUP_ENV_WRITABLE_KEYS as readonly string[]).includes(key);
}

export function localEnvFilePath(cwd = process.cwd()): string {
  return path.join(cwd, ".env.local");
}

export function upsertEnvFile(filePath: string, key: SetupEnvWritableKey, value: string): void {
  if (!isWritableKey(key)) {
    throw new Error("This setting cannot be written from the setup screen.");
  }
  if (!value.trim()) {
    throw new Error("A value is required.");
  }
  if (/[\r\n\0]/.test(value)) {
    throw new Error("A setting value must be a single line.");
  }

  let text = "";
  try {
    text = readFileSync(filePath, "utf8");
  } catch {
    text = "";
  }

  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, "m");
  if (pattern.test(text)) {
    text = text.replace(pattern, line);
  } else {
    const prefix = text.length === 0 || text.endsWith("\n") ? text : `${text}\n`;
    text = `${prefix}${line}\n`;
  }

  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, text, "utf8");
}
