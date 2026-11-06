/**
 * Compact labels for the agent's routine tool calls (searches, page reads,
 * delegated tasks, lookups). A run of them renders as one activity row instead
 * of a stack of tool cards, so a research turn reads as a few lines of progress
 * and the reply, not a wall of JSON.
 */

export const EMAIL_TOOLS = new Set(["send_email", "draft_email", "inbox_reply"]);

type ActivityKind = "search" | "read" | "delegate" | "inbox" | "files" | "skill" | "command" | "other";

type ToolLike = {
  readonly toolName: string;
  readonly input?: unknown;
  readonly state: string;
};

const KIND_BY_TOOL: Record<string, ActivityKind> = {
  agent: "delegate",
  bash: "command",
  inbox_thread: "inbox",
  inbox_threads: "inbox",
  inbox_organize: "inbox",
  list_documents: "files",
  list_emails: "inbox",
  list_folders: "files",
  load_skill: "skill",
  read_document: "files",
  read_email: "inbox",
  web_fetch: "read",
  web_search: "search",
};

const KIND_PHRASES: Record<ActivityKind, { readonly one: string; readonly many: (count: number) => string }> = {
  command: { one: "Ran a command", many: (n) => `ran ${n} commands` },
  delegate: { one: "Delegated a task", many: (n) => `delegated ${n} tasks` },
  files: { one: "Looked through files", many: (n) => `${n} file lookups` },
  inbox: { one: "Checked the inbox", many: (n) => `${n} inbox lookups` },
  other: { one: "Used a tool", many: (n) => `${n} other steps` },
  read: { one: "Read a page", many: (n) => `read ${n} pages` },
  search: { one: "Searched the web", many: (n) => `searched the web ${n} times` },
  skill: { one: "Loaded a skill", many: (n) => `loaded ${n} skills` },
};

const KIND_ORDER: readonly ActivityKind[] = [
  "search",
  "read",
  "delegate",
  "inbox",
  "files",
  "skill",
  "command",
  "other",
];

export function activityKind(toolName: string): ActivityKind {
  return KIND_BY_TOOL[toolName] ?? "other";
}

function inputRecord(input: unknown): Record<string, unknown> {
  return input && typeof input === "object" && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : {};
}

function stringField(input: unknown, ...keys: string[]): string | undefined {
  const record = inputRecord(input);
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

export function truncate(text: string, max: number): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? `${oneLine.slice(0, max - 1).trimEnd()}…` : oneLine;
}

function pageLabel(url: string): string {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname === "/" ? "" : parsed.pathname;
    return truncate(`${parsed.hostname.replace(/^www\./, "")}${path}`, 64);
  } catch {
    return truncate(url, 64);
  }
}

function humanToolName(toolName: string): string {
  const words = toolName.replace(/__/g, " ").replace(/_/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "Tool";
}

/** One line for a single tool call: what it did, and on what. */
export function activityLabel(part: ToolLike): { readonly title: string; readonly detail?: string } {
  const kind = activityKind(part.toolName);
  const running = part.state === "input-streaming" || part.state === "input-available";
  switch (kind) {
    case "search": {
      const query = stringField(part.input, "query");
      return {
        title: running ? "Searching the web" : "Searched the web",
        detail: query ? truncate(query, 80) : undefined,
      };
    }
    case "read": {
      const url = stringField(part.input, "url");
      return { title: running ? "Reading" : "Read", detail: url ? pageLabel(url) : undefined };
    }
    case "delegate": {
      const message = stringField(part.input, "message");
      return {
        title: running ? "Working on a delegated task" : "Delegated a task",
        detail: message ? truncate(message, 90) : undefined,
      };
    }
    case "skill": {
      const name = stringField(part.input, "name", "skill", "slug", "identifier");
      return { title: running ? "Loading a skill" : "Loaded a skill", detail: name };
    }
    case "inbox":
      return {
        title: running ? "Checking the inbox" : "Checked the inbox",
        detail: stringField(part.input, "query", "threadId", "id"),
      };
    case "files":
      return {
        title: running ? "Looking through files" : "Looked through files",
        detail: stringField(part.input, "query", "id"),
      };
    case "command":
      return {
        title: running ? "Running a command" : "Ran a command",
        detail: stringField(part.input, "command"),
      };
    default:
      return { title: humanToolName(part.toolName) };
  }
}

/** "Searched the web 6 times · read 4 pages" for a run of tool calls. */
export function activitySummary(parts: readonly ToolLike[]): string {
  if (parts.length === 1) return activityLabel(parts[0] as ToolLike).title;
  const counts = new Map<ActivityKind, number>();
  for (const part of parts) {
    const kind = activityKind(part.toolName);
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  const phrases = KIND_ORDER.flatMap((kind) => {
    const count = counts.get(kind) ?? 0;
    if (count === 0) return [];
    return [count === 1 ? KIND_PHRASES[kind].one.toLowerCase() : KIND_PHRASES[kind].many(count)];
  });
  const text = phrases.join(" · ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export type PartSegment<TPart> =
  | { readonly type: "part"; readonly part: TPart; readonly index: number }
  | { readonly type: "activity"; readonly parts: readonly TPart[]; readonly key: string };

/**
 * Split message parts into standalone parts and runs of routine tool calls.
 * `step-start` markers and parts `isHidden` rejects are dropped and never
 * break a run; anything else that renders does.
 */
export function segmentMessageParts<TPart extends { readonly type: string }>(
  parts: readonly TPart[],
  isActivity: (part: TPart) => boolean,
  activityKey: (part: TPart) => string,
  isHidden: (part: TPart) => boolean = () => false,
): PartSegment<TPart>[] {
  const segments: PartSegment<TPart>[] = [];
  let run: TPart[] = [];
  const flush = () => {
    if (run.length === 0) return;
    segments.push({ type: "activity", parts: run, key: `activity:${activityKey(run[0] as TPart)}` });
    run = [];
  };
  parts.forEach((part, index) => {
    if (part.type === "step-start" || isHidden(part)) return;
    if (isActivity(part)) {
      run.push(part);
      return;
    }
    flush();
    segments.push({ type: "part", part, index });
  });
  flush();
  return segments;
}

export type EmailCardStatus =
  | "writing"
  | "sending"
  | "sent"
  | "draft"
  | "not-sent"
  | "awaiting-approval"
  | "denied"
  | "failed";

/** Where an email tool call stands, from its state and output. */
export function emailCardStatus(part: ToolLike & { readonly output?: unknown }): EmailCardStatus {
  switch (part.state) {
    case "input-streaming":
      return "writing";
    case "input-available":
    case "approval-responded":
      return part.toolName === "draft_email" ? "writing" : "sending";
    case "approval-requested":
      return "awaiting-approval";
    case "output-denied":
      return "denied";
    case "output-error":
      return "failed";
  }
  const output = inputRecord(part.output);
  if (part.toolName === "draft_email" || output.drafted === true || output.status === "draft") {
    return "draft";
  }
  return output.sent === false ? "not-sent" : "sent";
}

export type EmailCardFields = {
  readonly to: string;
  readonly cc?: string;
  readonly subject?: string;
  readonly body?: string;
  readonly attachmentCount: number;
  readonly href?: string;
  readonly message?: string;
};

function addressText(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (Array.isArray(value)) {
    const list = value.filter((item): item is string => typeof item === "string" && item.trim() !== "");
    return list.length > 0 ? list.join(", ") : undefined;
  }
  return undefined;
}

/** What to show on an email card. Omitted `to` means the signed-in user. */
export function emailCardFields(part: ToolLike & { readonly output?: unknown }): EmailCardFields {
  const input = inputRecord(part.input);
  const output = inputRecord(part.output);
  const draft = inputRecord(output.draft);
  const to =
    addressText(output.to) ??
    addressText(draft.to) ??
    addressText(input.to) ??
    (part.toolName === "inbox_reply" ? "Thread participants" : "You");
  const documentIds = Array.isArray(input.documentIds) ? input.documentIds.length : 0;
  return {
    to,
    cc: addressText(input.cc),
    subject: stringField(output, "subject") ?? stringField(input, "subject"),
    body: stringField(input, "body", "text"),
    attachmentCount: documentIds,
    // Only an in-app path: the card links it, so never a scheme or another host.
    href:
      typeof output.href === "string" && /^\/(?!\/)/.test(output.href) ? output.href : undefined,
    message: typeof output.message === "string" ? output.message : undefined,
  };
}
