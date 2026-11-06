"use client";

import {
  BotIcon,
  ChevronRightIcon,
  FileSearchIcon,
  GlobeIcon,
  InboxIcon,
  type LucideIcon,
  MailIcon,
  PaperclipIcon,
  SearchIcon,
  SparklesIcon,
  TerminalIcon,
  WrenchIcon,
  XCircleIcon,
} from "lucide-react";
import Link from "next/link";
import { type ReactNode, useState } from "react";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  activityKind,
  activityLabel,
  activitySummary,
  type EmailCardFields,
  type EmailCardStatus,
} from "@/lib/tool-activity";
import { cn } from "@/lib/utils";

type ActivityPart = {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly input?: unknown;
  readonly state: string;
};

const KIND_ICONS: Record<ReturnType<typeof activityKind>, LucideIcon> = {
  command: TerminalIcon,
  delegate: BotIcon,
  files: FileSearchIcon,
  inbox: InboxIcon,
  other: WrenchIcon,
  read: GlobeIcon,
  search: SearchIcon,
  skill: SparklesIcon,
};

const KIND_RANK = ["search", "read", "delegate", "inbox", "files", "skill", "command", "other"];

/** The step whose kind leads the summary line, so the icon matches its first words. */
function leadingPart<TPart extends ActivityPart>(parts: readonly TPart[]): TPart | undefined {
  return [...parts].sort(
    (a, b) => KIND_RANK.indexOf(activityKind(a.toolName)) - KIND_RANK.indexOf(activityKind(b.toolName)),
  )[0];
}

function isRunning(state: string): boolean {
  return state === "input-streaming" || state === "input-available";
}

function isFailed(state: string): boolean {
  return state === "output-error" || state === "output-denied";
}

/**
 * A run of routine tool calls as one quiet row: the latest step while it
 * works, a one-line summary once done. Expanding lists each step, and each
 * step expands to its raw parameters and result for debugging.
 */
export function ToolActivityGroup<TPart extends ActivityPart>({
  parts,
  renderDetail,
}: {
  readonly parts: readonly TPart[];
  readonly renderDetail: (part: TPart) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const running = parts.some((part) => isRunning(part.state));
  const failures = parts.filter((part) => isFailed(part.state)).length;
  const current = [...parts].reverse().find((part) => isRunning(part.state));
  const currentLabel = current ? activityLabel(current) : undefined;
  const Icon = KIND_ICONS[activityKind((current ?? leadingPart(parts))?.toolName ?? "")];
  const summary = activitySummary(parts);

  return (
    <Collapsible className="not-prose mb-3 w-full" onOpenChange={setOpen} open={open}>
      <CollapsibleTrigger
        className="group/activity flex w-full min-w-0 items-center gap-2 rounded-md py-1 text-left text-muted-foreground text-sm transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
      >
        <Icon aria-hidden="true" className={cn("size-4 shrink-0", running && "animate-pulse")} />
        <span className="min-w-0 truncate">
          {running && currentLabel ? (
            <Shimmer as="span" duration={1.5}>
              {currentLabel.detail
                ? `${currentLabel.title}: ${currentLabel.detail}`
                : `${currentLabel.title}…`}
            </Shimmer>
          ) : (
            summary
          )}
        </span>
        {failures > 0 ? (
          <span className="flex shrink-0 items-center gap-1 text-destructive text-xs">
            <XCircleIcon aria-hidden="true" className="size-3" />
            {failures} failed
          </span>
        ) : null}
        {parts.length > 1 ? (
          <span className="shrink-0 text-xs tabular-nums">{parts.length} steps</span>
        ) : null}
        <ChevronRightIcon
          aria-hidden="true"
          className="size-4 shrink-0 transition-transform group-data-[state=open]/activity:rotate-90"
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-1 space-y-1 border-l pl-4">
        {open
          ? parts.map((part) => (
              <ActivityStep key={part.toolCallId} part={part} renderDetail={renderDetail} />
            ))
          : null}
      </CollapsibleContent>
    </Collapsible>
  );
}

function ActivityStep<TPart extends ActivityPart>({
  part,
  renderDetail,
}: {
  readonly part: TPart;
  readonly renderDetail: (part: TPart) => ReactNode;
}) {
  const label = activityLabel(part);
  const Icon = KIND_ICONS[activityKind(part.toolName)];
  return (
    <Collapsible className="group/step">
      <CollapsibleTrigger className="flex w-full min-w-0 items-center gap-2 rounded-md py-1 text-left text-muted-foreground text-xs transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">
        <Icon aria-hidden="true" className="size-3.5 shrink-0" />
        <span className="shrink-0 font-medium text-foreground/80">{label.title}</span>
        {label.detail ? <span className="min-w-0 truncate">{label.detail}</span> : null}
        {isFailed(part.state) ? (
          <XCircleIcon aria-label="Failed" className="size-3 shrink-0 text-destructive" />
        ) : null}
        <ChevronRightIcon
          aria-hidden="true"
          className="ml-auto size-3.5 shrink-0 transition-transform group-data-[state=open]/step:rotate-90"
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="py-2">{renderDetail(part)}</CollapsibleContent>
    </Collapsible>
  );
}

const STATUS_COPY: Record<EmailCardStatus, { readonly label: string; readonly tone: string }> = {
  "awaiting-approval": {
    label: "Needs approval",
    tone: "bg-amber-500/15 text-amber-800 dark:text-amber-200",
  },
  denied: { label: "Not sent", tone: "bg-muted text-muted-foreground" },
  draft: { label: "Draft", tone: "bg-muted text-muted-foreground" },
  failed: { label: "Failed to send", tone: "bg-destructive/10 text-destructive" },
  "not-sent": { label: "Not sent", tone: "bg-destructive/10 text-destructive" },
  sending: { label: "Sending…", tone: "bg-blue-500/10 text-blue-800 dark:text-blue-200" },
  sent: { label: "Sent", tone: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-200" },
  writing: { label: "Writing…", tone: "bg-muted text-muted-foreground" },
};

/**
 * An email the agent sent, drafted, or wants to send, shown as an email: who
 * it goes to, the subject, and the body, with the approval controls (when it
 * needs one) right under the message they decide on.
 */
export function EmailToolCard({
  approval,
  errorText,
  fields,
  status,
}: {
  readonly approval?: ReactNode;
  readonly errorText?: string;
  readonly fields: EmailCardFields;
  readonly status: EmailCardStatus;
}) {
  const [expanded, setExpanded] = useState(status === "awaiting-approval");
  const copy = STATUS_COPY[status];
  const body = fields.body ?? "";
  const long = body.length > 420 || body.split("\n").length > 8;

  return (
    <div
      className={cn(
        "not-prose mb-4 w-full overflow-hidden rounded-lg border bg-card text-card-foreground",
        status === "awaiting-approval" && "border-amber-500/40",
      )}
    >
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <MailIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate font-medium text-sm">
          {fields.subject || (status === "writing" ? "Writing an email…" : "(no subject)")}
        </span>
        <Badge className={cn("shrink-0 rounded-full border-0 text-xs", copy.tone)} variant="secondary">
          {status === "sending" || status === "writing" ? (
            <Shimmer as="span" duration={1.5}>
              {copy.label}
            </Shimmer>
          ) : (
            copy.label
          )}
        </Badge>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 px-3 pt-2 text-sm">
        <dt className="text-muted-foreground">To</dt>
        <dd className="min-w-0 break-words">{fields.to}</dd>
        {fields.cc ? (
          <>
            <dt className="text-muted-foreground">Cc</dt>
            <dd className="min-w-0 break-words">{fields.cc}</dd>
          </>
        ) : null}
      </dl>
      {body ? (
        <div className="px-3 pt-2 pb-3">
          <p
            className={cn(
              "whitespace-pre-wrap break-words text-muted-foreground text-sm",
              long && !expanded && "line-clamp-6",
            )}
          >
            {body}
          </p>
          {long ? (
            <button
              className="mt-1 text-foreground text-xs underline-offset-2 hover:underline"
              type="button"
              onClick={() => setExpanded((value) => !value)}
            >
              {expanded ? "Show less" : "Show full email"}
            </button>
          ) : null}
        </div>
      ) : (
        <div className="pb-2" />
      )}
      {fields.attachmentCount > 0 ? (
        <p className="flex items-center gap-1.5 px-3 pb-3 text-muted-foreground text-xs">
          <PaperclipIcon aria-hidden="true" className="size-3.5" />
          {fields.attachmentCount === 1 ? "1 attachment" : `${fields.attachmentCount} attachments`}
        </p>
      ) : null}
      {errorText || (status === "not-sent" && fields.message) ? (
        <p className="border-t bg-destructive/5 px-3 py-2 text-destructive text-sm" role="alert">
          {errorText ?? fields.message}
        </p>
      ) : null}
      {approval ? <div className="border-t px-3 py-3">{approval}</div> : null}
      {fields.href && status === "sent" ? (
        <div className="border-t px-3 py-2">
          <Link className="text-sm underline-offset-2 hover:underline" href={fields.href}>
            Open in Inbox
          </Link>
        </div>
      ) : null}
    </div>
  );
}
