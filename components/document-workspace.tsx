"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckIcon, ClipboardIcon, DownloadIcon, Trash2Icon } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AppHeader } from "@/components/app-header";
import { DocumentEditor } from "@/components/document-editor";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FileVisibilitySelect } from "@/components/visibility-toggle";
import { documentKindLabel } from "@/lib/document-kind";
import { fetchJson, formatBytes, formatRelativeTime, formatSessionUpdatedAt } from "@/lib/utils";
import type { ChatRecord, ClientDocument } from "@/lib/types";
import { isPublicVisibility, type ResourceVisibility } from "@/lib/visibility";

export function DocumentWorkspace({
  chats,
  document,
  initialContent,
}: {
  readonly chats: ChatRecord[];
  readonly document: ClientDocument;
  readonly initialContent: string;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(document.title);
  const [content, setContent] = useState(initialContent);
  const [isPublic, setIsPublic] = useState(document.isPublic);
  const [visibility, setVisibility] = useState<ResourceVisibility>(document.visibility);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string>();
  const [savedAt, setSavedAt] = useState(document.updatedAt);
  const origin = useSyncExternalStore(
    () => () => undefined,
    () => window.location.origin,
    () => "",
  );

  const skipAutosave = useRef(true);
  const sharePath = `/d/${document.shareId}`;
  const shareHref = origin ? `${origin}${sharePath}` : sharePath;

  const save = async (patch: {
    content?: string;
    title?: string;
    isPublic?: boolean;
    visibility?: ResourceVisibility;
  }) => {
    setSaving(true);
    setError(undefined);
    const response = await fetchJson(`/api/documents/${document.id}`, "PATCH", patch);
    setSaving(false);
    if (!response.ok) {
      setError("Unable to save this file.");
      return;
    }
    const payload = (await response.json()) as { document: ClientDocument };
    setIsPublic(payload.document.isPublic);
    setVisibility(payload.document.visibility);
    setSavedAt(payload.document.updatedAt);
  };

  useEffect(() => {
    if (skipAutosave.current) {
      skipAutosave.current = false;
      return;
    }
    const handle = window.setTimeout(() => {
      void save(document.editable ? { content, title } : { title });
    }, 700);
    return () => window.clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- debounce on editor fields only
  }, [content, title]);

  const copyShareLink = () => {
    const href = `${window.location.origin}${sharePath}`;
    const fallbackCopy = () => {
      const input = window.document.createElement("textarea");
      input.value = href;
      window.document.body.append(input);
      input.select();
      window.document.execCommand("copy");
      input.remove();
    };
    try {
      if (navigator.clipboard?.writeText) {
        void navigator.clipboard.writeText(href).catch(fallbackCopy);
      } else {
        fallbackCopy();
      }
    } catch {
      fallbackCopy();
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  const remove = async () => {
    const response = await fetch(`/api/documents/${document.id}`, { method: "DELETE" });
    if (!response.ok) {
      setError("Unable to delete this file.");
      return;
    }
    router.push("/files");
  };

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background">
      <AppHeader backHref="/files" />
      <main
        className="mx-auto flex min-h-0 w-full max-w-4xl flex-1 flex-col gap-4 px-4 pt-6 pb-[max(1rem,env(safe-area-inset-bottom))]"
        id="main"
        tabIndex={-1}
      >
        <div className="shrink-0 space-y-3">
          <div className="flex items-center gap-2">
            <Input
              aria-label="File title"
              className="h-9 min-w-0 flex-1 border-transparent px-3 text-lg font-medium shadow-none md:text-lg dark:bg-transparent"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
            <Button asChild size="icon" variant="outline">
              <a aria-label="Download file" href={`${document.fileHref}?download=1`}>
                <DownloadIcon />
              </a>
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  aria-label="Delete file"
                  className="text-destructive hover:bg-destructive/10 hover:text-destructive dark:hover:bg-destructive/20"
                  size="icon"
                  type="button"
                  variant="ghost"
                >
                  <Trash2Icon />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete this file?</AlertDialogTitle>
                  <AlertDialogDescription>
                    The file is removed from your library and any public link stops working.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction variant="destructive" onClick={() => void remove()}>
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-muted-foreground text-xs">
            <Badge variant="secondary">{documentKindLabel(document.kind)}</Badge>
            <span>{formatBytes(document.size)}</span>
            <span aria-hidden>·</span>
            <span>{saving ? "Saving…" : `Updated ${formatRelativeTime(savedAt)}`}</span>
            <FileVisibilitySelect
              id="document-visibility"
              value={visibility}
              onChange={(next) => {
                setVisibility(next);
                setIsPublic(isPublicVisibility(next));
                void save({ visibility: next });
              }}
            />
            {isPublicVisibility(visibility) || isPublic ? (
              <span className="inline-flex min-w-0 max-w-72 items-center gap-1 text-foreground">
                <a
                  className="min-w-0 truncate text-muted-foreground hover:text-foreground hover:underline"
                  href={shareHref}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  {shareHref}
                </a>
                <Button
                  aria-label={copied ? "Public link copied" : "Copy public link"}
                  size="icon-xs"
                  type="button"
                  variant="ghost"
                  onClick={copyShareLink}
                >
                  {copied ? <CheckIcon /> : <ClipboardIcon />}
                </Button>
              </span>
            ) : null}
          </div>
        </div>

        {chats.length > 0 ? (
          <section className="shrink-0 space-y-1.5">
            <h2 className="font-medium text-muted-foreground text-xs uppercase tracking-wider">
              Linked sessions
            </h2>
            <ul className="max-h-36 space-y-1 overflow-y-auto">
              {chats.map((chat) => (
                <li key={chat.id}>
                  <Link
                    className="block truncate text-muted-foreground text-sm transition-colors hover:text-foreground"
                    href={`/s/${chat.id}`}
                    prefetch={false}
                  >
                    {chat.title}
                    <span suppressHydrationWarning>
                      {` (${formatSessionUpdatedAt(chat.updatedAt)})`}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {error ? (
          <p className="shrink-0 text-destructive text-sm" role="alert">
            {error}
          </p>
        ) : null}

        <DocumentEditor
          content={content}
          disabled={!document.editable}
          fileHref={document.fileHref}
          fillHeight
          kind={document.kind}
          title={title}
          onChange={setContent}
        />
      </main>
    </div>
  );
}
