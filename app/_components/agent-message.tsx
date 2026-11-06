"use client";

import type {
  EveAuthorizationPart,
  EveDynamicToolPart,
  EveMessage,
  EveMessageInputRequest,
  EveMessagePart,
} from "eve/react";
import { useState } from "react";
import {
  ArrowRightIcon,
  CheckCircleIcon,
  CheckIcon,
  CopyIcon,
  ExternalLinkIcon,
  FileTextIcon,
  KeyRoundIcon,
  XCircleIcon,
} from "lucide-react";
import {
  Attachment,
  AttachmentInfo,
  AttachmentPreview,
  Attachments,
} from "@/components/ai-elements/attachments";
import {
  Confirmation,
  ConfirmationAccepted,
  ConfirmationAction,
  ConfirmationActions,
  ConfirmationRejected,
  ConfirmationTitle,
} from "@/components/ai-elements/confirmation";
import { Image } from "@/components/ai-elements/image";
import {
  Message,
  MessageAction,
  MessageActions,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import {
  Question,
  QuestionInput,
  QuestionOption,
  QuestionOptions,
  QuestionPrompt,
  type QuestionResponse,
  QuestionSubmit,
  type QuestionValue,
} from "@/components/ai-elements/question";
import { Reasoning, ReasoningContent, ReasoningTrigger } from "@/components/ai-elements/reasoning";
import { Source, Sources, SourcesContent, SourcesTrigger } from "@/components/ai-elements/sources";
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from "@/components/ai-elements/tool";
import { Button } from "@/components/ui/button";
import {
  SessionCitationFooter,
  sessionCitationComponents,
  type SessionCitationNav,
} from "@/components/session-citations";
import { DOCUMENT_TOOLS, documentsFromToolOutput } from "@/lib/client-documents";
import { documentKindLabel } from "@/lib/document-kind";
import {
  EMAIL_TOOLS,
  emailCardFields,
  emailCardStatus,
  segmentMessageParts,
} from "@/lib/tool-activity";
import { EmailToolCard, ToolActivityGroup } from "@/components/tool-activity";
import {
  displaySessionCitationText,
  linkifySessionCitations,
  relatedChatsForFooter,
} from "@/lib/session-citations";
import {
  EMPTY_GENERATED_IMAGE_BYTES,
  GENERATE_IMAGE_TOOL,
  generatedImageDataUrl,
  generatedImageDimensions,
  generatedImageSizeFromOutput,
  generatedImagesFromToolOutput,
  type GeneratedImage,
} from "@/lib/generated-image";
import type { ClientDocument, SessionCitation } from "@/lib/types";
import { cn } from "@/lib/utils";

export type AgentInputResponse = {
  readonly optionId?: string;
  readonly requestId: string;
  readonly text?: string;
};

type EveFilePart = Extract<EveMessagePart, { type: "file" }>;

export function AgentMessage({
  canRespond,
  citationNav,
  citations = [],
  isStreaming,
  message,
  onInputResponses,
  onOpenDocument,
}: {
  readonly canRespond: boolean;
  readonly citationNav: SessionCitationNav;
  readonly citations?: readonly SessionCitation[];
  readonly isStreaming: boolean;
  readonly message: EveMessage;
  readonly onInputResponses: (responses: readonly AgentInputResponse[]) => void | Promise<void>;
  readonly onOpenDocument?: (document: ClientDocument) => void;
}) {
  const lastTextIndex = message.parts.reduce(
    (last, part, index) => (part.type === "text" ? index : last),
    -1,
  );
  const hasAssistantText =
    message.role === "assistant" &&
    message.parts.some((part) => part.type === "text" && part.text.length > 0);
  const sources = collectSources(message.parts);
  const assistantText = message.parts
    .flatMap((part) => (part.type === "text" && part.text ? [part.text] : []))
    .join("\n");
  const relatedSessions = relatedChatsForFooter(assistantText, citations);
  const citationComponents = sessionCitationComponents(citations, citationNav);

  return (
    <Message
      data-optimistic={message.metadata?.optimistic ? "true" : undefined}
      from={message.role}
    >
      {sources.length > 0 ? (
        <Sources>
          <SourcesTrigger count={sources.length} />
          <SourcesContent>
            {sources.map((source) => (
              <Source href={source.href} key={source.href} title={source.title} />
            ))}
          </SourcesContent>
        </Sources>
      ) : null}
      <MessageContent>
        {segmentMessageParts(
          message.parts,
          isActivityPart,
          (part) => (part.type === "dynamic-tool" ? part.toolCallId : part.type),
          (part) => hasAssistantText && part.type === "reasoning",
        ).map((segment) =>
          segment.type === "activity" ? (
            <ToolActivityGroup
              key={segment.key}
              parts={segment.parts.filter(
                (part): part is EveDynamicToolPart => part.type === "dynamic-tool",
              )}
              renderDetail={(part) => (
                <div className="space-y-3">
                  <ToolInput input={part.input} />
                  <ToolOutput errorText={part.errorText} output={part.output} />
                </div>
              )}
            />
          ) : (
            <AgentMessagePart
              canRespond={canRespond}
              citations={citations}
              citationComponents={citationComponents}
              key={partKey(segment.part, segment.index)}
              onInputResponses={onInputResponses}
              onOpenDocument={onOpenDocument}
              part={segment.part}
              role={message.role}
              showCaret={
                isStreaming && message.role === "assistant" && segment.index === lastTextIndex
              }
            />
          ),
        )}
        {hasAssistantText && relatedSessions.length > 0 ? (
          <SessionCitationFooter items={relatedSessions} nav={citationNav} />
        ) : null}
      </MessageContent>
      {hasAssistantText && !isStreaming ? (
        <CopyResponseAction text={displaySessionCitationText(assistantText, citations)} />
      ) : null}
    </Message>
  );
}

function AgentMessagePart({
  canRespond,
  citationComponents,
  citations,
  onInputResponses,
  onOpenDocument,
  part,
  role,
  showCaret,
}: {
  readonly canRespond: boolean;
  readonly citationComponents: ReturnType<typeof sessionCitationComponents>;
  readonly citations: readonly SessionCitation[];
  readonly onInputResponses: (responses: readonly AgentInputResponse[]) => void | Promise<void>;
  readonly onOpenDocument?: (document: ClientDocument) => void;
  readonly part: EveMessagePart;
  readonly role: EveMessage["role"];
  readonly showCaret: boolean;
}) {
  switch (part.type) {
    case "step-start":
      return null;
    case "text":
      return (
        <MessageResponse
          caret="block"
          className={role === "user" ? "size-auto w-auto" : undefined}
          components={role === "assistant" ? citationComponents : undefined}
          isAnimating={showCaret}
        >
          {role === "assistant" ? linkifySessionCitations(part.text, citations) : part.text}
        </MessageResponse>
      );
    case "reasoning":
      return (
        <Reasoning defaultOpen isStreaming={part.state === "streaming"}>
          <ReasoningTrigger />
          <ReasoningContent>{part.text}</ReasoningContent>
        </Reasoning>
      );
    case "file":
      return <AttachmentPart part={part} />;
    case "authorization":
      return <AuthorizationPrompt part={part} />;
    case "dynamic-tool": {
      const inputRequest = part.toolMetadata?.eve?.inputRequest;
      if (inputRequest?.kind === "question") {
        return (
          <QuestionRequest
            canRespond={canRespond}
            inputRequest={inputRequest}
            inputResponse={part.toolMetadata?.eve?.inputResponse}
            onInputResponses={onInputResponses}
          />
        );
      }

      if (EMAIL_TOOLS.has(part.toolName)) {
        return (
          <EmailToolCard
            approval={
              part.toolMetadata?.eve?.inputRequest ? (
                <ToolApproval
                  canRespond={canRespond}
                  onInputResponses={onInputResponses}
                  part={part}
                />
              ) : undefined
            }
            errorText={part.errorText}
            fields={emailCardFields(part)}
            status={emailCardStatus(part)}
          />
        );
      }

      if (part.toolName === GENERATE_IMAGE_TOOL) {
        return (
          <GeneratedImageTool
            canRespond={canRespond}
            onInputResponses={onInputResponses}
            onOpenDocument={onOpenDocument}
            part={part}
          />
        );
      }

      if (DOCUMENT_TOOLS.has(part.toolName) && part.state === "output-available") {
        const documents = documentsFromToolOutput(part.output);
        return (
          <div className="space-y-3">
            <Tool>
              <ToolHeader
                state={part.state}
                title={part.toolName.replaceAll("_", " ")}
                toolName={part.toolName}
                type="dynamic-tool"
              />
              <ToolContent>
                <ToolInput input={part.input} />
                <ToolApproval
                  canRespond={canRespond}
                  onInputResponses={onInputResponses}
                  part={part}
                />
              </ToolContent>
            </Tool>
            {documents.map((document) => (
              <DocumentCard
                document={document}
                key={document.id}
                onOpen={onOpenDocument}
              />
            ))}
          </div>
        );
      }

      return (
        <Tool
          defaultOpen={part.state === "approval-requested" || part.state === "approval-responded"}
        >
          <ToolHeader
            state={part.state}
            title={part.toolName}
            toolName={part.toolName}
            type="dynamic-tool"
          />
          <ToolContent>
            <ToolInput input={part.input} />
            <ToolApproval
              canRespond={canRespond}
              onInputResponses={onInputResponses}
              part={part}
            />
            <ToolOutput errorText={part.errorText} output={part.output} />
          </ToolContent>
        </Tool>
      );
    }
  }
}

function QuestionRequest({
  canRespond,
  inputRequest,
  inputResponse,
  onInputResponses,
}: {
  readonly canRespond: boolean;
  readonly inputRequest: EveMessageInputRequest;
  readonly inputResponse?: AgentInputResponse;
  readonly onInputResponses: (responses: readonly AgentInputResponse[]) => void | Promise<void>;
}) {
  const hasOptions = (inputRequest.options?.length ?? 0) > 0;
  const acceptsFreeform = inputRequest.allowFreeform === true || !hasOptions;
  const [questionValue, setQuestionValue] = useState<QuestionValue>({
    selectedValues: inputResponse?.optionId ? [inputResponse.optionId] : [],
    text: inputResponse?.text ?? "",
  });

  const submitOption = (optionId: string) => {
    setQuestionValue((value) => ({ ...value, selectedValues: [optionId] }));
    return onInputResponses([
      {
        optionId,
        requestId: inputRequest.requestId,
      },
    ]);
  };

  const submitResponse = ({ selectedValues, text }: QuestionResponse) =>
    onInputResponses([
      {
        optionId: selectedValues[0],
        requestId: inputRequest.requestId,
        text,
      },
    ]);

  return (
    <Question
      disabled={!canRespond || inputResponse !== undefined}
      onSubmit={submitResponse}
      onValueChange={setQuestionValue}
      value={questionValue}
    >
      <QuestionPrompt>{inputRequest.prompt}</QuestionPrompt>
      {hasOptions ? (
        <QuestionOptions className="flex-col items-stretch" aria-label={inputRequest.prompt}>
          {inputRequest.options?.map((option, index) => (
            <QuestionOption
              className="justify-start px-3 py-2 text-left"
              key={option.id}
              onClick={() => void submitOption(option.id)}
              value={option.id}
            >
              <span className="min-w-0 flex-1">
                <span className="block text-foreground text-sm leading-tight">{option.label}</span>
                {option.description ? (
                  <span className="block text-sm text-muted-foreground leading-tight">
                    {option.description}
                  </span>
                ) : null}
              </span>
              {inputResponse === undefined ? (
                <span aria-hidden="true" className="relative size-6 shrink-0">
                  <span className="absolute inset-0 flex items-center justify-center rounded-full bg-foreground/8 text-xs text-muted-foreground transition-opacity group-hover/option:opacity-0 group-focus-visible/option:opacity-0">
                    {index + 1}
                  </span>
                  <ArrowRightIcon className="absolute top-1/2 left-1/2 size-4 -translate-x-1/2 -translate-y-1/2 text-muted-foreground opacity-0 transition-[color,opacity] group-hover/option:text-foreground group-hover/option:opacity-100 group-focus-visible/option:opacity-100" />
                </span>
              ) : (
                <CheckIcon className="size-4 shrink-0 opacity-0 transition-opacity group-data-[state=checked]/option:opacity-100" />
              )}
            </QuestionOption>
          ))}
        </QuestionOptions>
      ) : null}
      {acceptsFreeform ? (
        <div className="relative">
          <QuestionInput
            aria-label="Answer"
            className={inputResponse === undefined ? "pr-12 pb-12" : undefined}
            placeholder="Type your answer…"
          />
          {inputResponse === undefined && questionValue.text.trim().length > 0 ? (
            <QuestionSubmit
              aria-label="Answer"
              className="absolute right-2 bottom-2"
              size="icon-sm"
            >
              <ArrowRightIcon />
            </QuestionSubmit>
          ) : null}
        </div>
      ) : null}
    </Question>
  );
}

function DocumentCard({
  document,
  onOpen,
}: {
  readonly document: ClientDocument;
  readonly onOpen?: (document: ClientDocument) => void;
}) {
  return (
    <button
      aria-label={`Open ${document.title}`}
      className="flex w-full items-start gap-3 rounded-xl border bg-card px-3 py-3 text-left transition-colors hover:bg-accent/40"
      type="button"
      onClick={() => onOpen?.(document)}
    >
      <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-muted">
        <FileTextIcon aria-hidden="true" className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium text-sm">{document.title}</span>
        <span className="text-muted-foreground text-xs">
          {documentKindLabel(document.kind)}
          {document.isPublic ? " · Public" : ""}
        </span>
      </span>
    </button>
  );
}

function GeneratedImageTool({
  canRespond,
  onInputResponses,
  onOpenDocument,
  part,
}: {
  readonly canRespond: boolean;
  readonly onInputResponses: (responses: readonly AgentInputResponse[]) => void | Promise<void>;
  readonly onOpenDocument?: (document: ClientDocument) => void;
  readonly part: EveDynamicToolPart;
}) {
  const images = generatedImagesFromToolOutput(part.output);
  const prompt =
    part.input &&
    typeof part.input === "object" &&
    "prompt" in part.input &&
    typeof part.input.prompt === "string"
      ? part.input.prompt
      : undefined;

  return (
    <div className="space-y-3">
      <Tool
        defaultOpen={
          part.state === "approval-requested" ||
          part.state === "approval-responded" ||
          part.state === "output-error"
        }
      >
        <ToolHeader
          state={part.state}
          title="Generate image"
          toolName={part.toolName}
          type="dynamic-tool"
        />
        <ToolContent>
          <ToolInput input={part.input} />
          <ToolApproval
            canRespond={canRespond}
            onInputResponses={onInputResponses}
            part={part}
          />
          {part.errorText || images.length === 0 ? (
            <ToolOutput errorText={part.errorText} output={part.output} />
          ) : null}
        </ToolContent>
      </Tool>
      {images.length > 0 ? (
        <GeneratedImageGallery
          images={images}
          prompt={prompt}
          size={generatedImageSizeFromOutput(part.output)}
        />
      ) : null}
      {documentsFromToolOutput(part.output).map((document) => (
        <DocumentCard document={document} key={document.id} onOpen={onOpenDocument} />
      ))}
    </div>
  );
}

function GeneratedImageGallery({
  images,
  prompt,
  size,
}: {
  readonly images: readonly GeneratedImage[];
  readonly prompt?: string;
  readonly size: string;
}) {
  const { height, width } = generatedImageDimensions(size);
  return (
    <div className="grid gap-3">
      {images.map((image) => {
        const url = generatedImageDataUrl(image);
        return (
          <a
            className="block overflow-hidden rounded-xl border bg-card"
            href={url}
            key={image.filename}
            rel="noreferrer"
            target="_blank"
          >
            <Image
              alt={prompt || image.filename}
              base64={image.base64}
              className="max-h-[32rem] w-full object-contain"
              height={height}
              mediaType={image.mediaType}
              uint8Array={EMPTY_GENERATED_IMAGE_BYTES}
              width={width}
            />
          </a>
        );
      })}
    </div>
  );
}

function CopyResponseAction({ text }: { readonly text: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <MessageActions>
      <MessageAction
        label="Copy response"
        tooltip="Copy"
        onClick={() => {
          void navigator.clipboard.writeText(text).then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 2000);
          });
        }}
      >
        {copied ? (
          <CheckIcon aria-hidden="true" className="size-3" />
        ) : (
          <CopyIcon aria-hidden="true" className="size-3" />
        )}
      </MessageAction>
    </MessageActions>
  );
}

function AttachmentPart({ part }: { readonly part: EveFilePart }) {
  const attachment = (
    <Attachments variant="list">
      <Attachment
        data={{
          filename: part.filename,
          id: part.filename ?? part.mediaType,
          mediaType: part.mediaType,
          type: "file",
          url: part.url ?? "",
        }}
      >
        <AttachmentPreview />
        <AttachmentInfo showMediaType />
      </Attachment>
    </Attachments>
  );

  return part.url ? (
    <a href={part.url} rel="noreferrer" target="_blank">
      {attachment}
    </a>
  ) : (
    attachment
  );
}

function AuthorizationPrompt({ part }: { readonly part: EveAuthorizationPart }) {
  const isAuthorized = part.state === "completed" && part.outcome === "authorized";
  const isCompleted = part.state === "completed";
  const Icon = isAuthorized ? CheckCircleIcon : isCompleted ? XCircleIcon : KeyRoundIcon;
  const instructions = part.authorization?.instructions;
  const shouldShowInstructions = instructions !== undefined && instructions !== part.description;

  return (
    <div
      className={cn(
        "space-y-3 rounded-md border p-3",
        isAuthorized
          ? "border-emerald-500/30 bg-emerald-500/5"
          : isCompleted
            ? "border-destructive/30 bg-destructive/5"
            : "border-blue-500/30 bg-blue-500/5",
      )}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full",
            isAuthorized
              ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
              : isCompleted
                ? "bg-destructive/10 text-destructive"
                : "bg-blue-500/10 text-blue-700 dark:text-blue-300",
          )}
        >
          <Icon className="size-4" />
        </span>
        <div className="min-w-0 flex-1 space-y-2">
          <p className="font-medium text-sm">{authorizationTitle(part)}</p>
          <p className="text-muted-foreground text-sm">{authorizationDescription(part)}</p>
          {shouldShowInstructions ? (
            <p className="text-muted-foreground text-sm">{instructions}</p>
          ) : null}
          {part.state === "required" && part.authorization?.userCode ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted-foreground">Code</span>
              <code className="rounded-md bg-background px-2 py-1 font-mono">
                {part.authorization.userCode}
              </code>
            </div>
          ) : null}
          {part.state === "required" && part.authorization?.url ? (
            <Button asChild size="sm">
              <a href={part.authorization.url} rel="noreferrer" target="_blank">
                <ExternalLinkIcon className="size-4" />
                Sign in with {part.displayName}
              </a>
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function authorizationTitle(part: EveAuthorizationPart): string {
  if (part.state === "required") {
    return `Connect ${part.displayName}`;
  }
  if (part.outcome === "authorized") {
    return `${part.displayName} connected`;
  }
  return `${part.displayName} authorization ${formatAuthorizationOutcome(part.outcome)}`;
}

function authorizationDescription(part: EveAuthorizationPart): string {
  if (part.state === "required") {
    return part.description;
  }
  if (part.outcome === "authorized") {
    return `${part.displayName} connected.`;
  }
  const tail = part.reason !== undefined ? ` (${part.reason})` : "";
  return `${part.displayName} authorization ${formatAuthorizationOutcome(part.outcome)}${tail}.`;
}

function formatAuthorizationOutcome(outcome: NonNullable<EveAuthorizationPart["outcome"]>): string {
  switch (outcome) {
    case "authorized":
      return "authorized";
    case "declined":
      return "declined";
    case "failed":
      return "failed";
    case "timed-out":
      return "timed out";
  }
}

function ToolApproval({
  canRespond,
  onInputResponses,
  part,
}: {
  readonly canRespond: boolean;
  readonly onInputResponses: (responses: readonly AgentInputResponse[]) => void | Promise<void>;
  readonly part: EveDynamicToolPart;
}) {
  const inputRequest = part.toolMetadata?.eve?.inputRequest;
  if (!inputRequest) {
    return null;
  }

  const inputResponse = part.toolMetadata?.eve?.inputResponse;
  const selectedOption = inputRequest.options?.find(
    (option) => option.id === inputResponse?.optionId,
  );
  const approval = toConfirmationApproval(
    "approval" in part ? part.approval : undefined,
    inputRequest.requestId,
    selectedOption?.style === "danger" ? false : inputResponse ? true : undefined,
  );

  return (
    <Confirmation approval={approval} state={part.state}>
      <ConfirmationTitle>{inputRequest.prompt}</ConfirmationTitle>
      <ConfirmationActions>
        {inputRequest.options?.map((option) => (
          <ConfirmationAction
            disabled={!canRespond}
            key={option.id}
            onClick={() => {
              void onInputResponses([
                {
                  optionId: option.id,
                  requestId: inputRequest.requestId,
                },
              ]);
            }}
            variant={option.style === "danger" ? "destructive" : "default"}
          >
            {option.label}
          </ConfirmationAction>
        ))}
      </ConfirmationActions>
      <ConfirmationAccepted>
        <ConfirmationTitle>
          Approved{selectedOption ? `: ${selectedOption.label}` : ""}
        </ConfirmationTitle>
      </ConfirmationAccepted>
      <ConfirmationRejected>
        <ConfirmationTitle>
          Denied{selectedOption ? `: ${selectedOption.label}` : ""}
        </ConfirmationTitle>
      </ConfirmationRejected>
    </Confirmation>
  );
}

function toConfirmationApproval(
  approval: { readonly id: string; readonly approved?: boolean; readonly reason?: string } | undefined,
  fallbackId: string,
  fallbackApproved?: boolean,
): { id: string } | { id: string; approved: boolean; reason?: string } {
  if (approval?.approved !== undefined) {
    return { approved: approval.approved, id: approval.id, reason: approval.reason };
  }
  if (fallbackApproved !== undefined) {
    return { approved: fallbackApproved, id: approval?.id ?? fallbackId };
  }
  return { id: approval?.id ?? fallbackId };
}

function collectSources(
  parts: readonly EveMessagePart[],
): readonly { href: string; title: string }[] {
  const sources: { href: string; title: string }[] = [];
  const seen = new Set<string>();

  for (const part of parts) {
    if (part.type !== "dynamic-tool" || part.state !== "output-available") {
      continue;
    }
    if (part.toolName !== "web_search") {
      continue;
    }

    for (const source of sourcesFromToolOutput(part.output)) {
      if (seen.has(source.href)) {
        continue;
      }
      seen.add(source.href);
      sources.push(source);
    }
  }

  return sources;
}

function sourcesFromToolOutput(output: unknown): readonly { href: string; title: string }[] {
  const records = Array.isArray(output)
    ? output
    : output && typeof output === "object"
      ? "results" in output && Array.isArray(output.results)
        ? output.results
        : "sources" in output && Array.isArray(output.sources)
          ? output.sources
          : []
      : [];

  return records.flatMap((record) => {
    if (!record || typeof record !== "object") {
      return [];
    }
    const href =
      "url" in record && typeof record.url === "string"
        ? record.url
        : "href" in record && typeof record.href === "string"
          ? record.href
          : undefined;
    if (!href) {
      return [];
    }
    const title =
      "title" in record && typeof record.title === "string" && record.title.length > 0
        ? record.title
        : href;
    return [{ href, title }];
  });
}

/** Routine tool calls that fold into one activity row (see lib/tool-activity.ts). */
function isActivityPart(part: EveMessagePart): boolean {
  if (part.type !== "dynamic-tool") return false;
  if (part.toolMetadata?.eve?.inputRequest) return false;
  if (part.state === "approval-requested" || part.state === "approval-responded") return false;
  return !(
    part.toolName === GENERATE_IMAGE_TOOL ||
    DOCUMENT_TOOLS.has(part.toolName) ||
    EMAIL_TOOLS.has(part.toolName)
  );
}

function partKey(part: EveMessagePart, index: number): string {
  switch (part.type) {
    case "authorization":
      return `authorization:${part.turnId}:${part.stepIndex}:${part.name}`;
    case "dynamic-tool":
      return part.toolCallId;
    default:
      return `${part.type}:${index}`;
  }
}
