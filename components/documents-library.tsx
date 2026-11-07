"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CheckIcon,
  FilePlus2Icon,
  FolderIcon,
  FolderOpenIcon,
  FolderPlusIcon,
  MoreHorizontalIcon,
  SearchIcon,
  Trash2Icon,
  UploadIcon,
} from "lucide-react";
import { useEffect, useRef, useState, type DragEvent } from "react";
import { AppHeader } from "@/components/app-header";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import type { DocumentLibrary } from "@/lib/documents";
import { MAX_DOCUMENT_BYTES } from "@/lib/document-upload";
import { documentKindLabel } from "@/lib/document-kind";
import { pushClientUrl } from "@/lib/start-web-session";
import { visibilityBadgeLabel } from "@/components/visibility-toggle";
import { UPLOAD_FILE_ERROR, uploadFiles as postLibraryUploads } from "@/components/documents-upload";
import type { ClientDocument, ClientFolder, DocumentSearchHit } from "@/lib/types";
import { cn, fetchJson, formatBytes, formatRelativeTime } from "@/lib/utils";

const blankKinds = [
  { kind: "text", label: "Text" },
  { kind: "markdown", label: "Markdown" },
  { kind: "csv", label: "CSV" },
  { kind: "html", label: "HTML" },
] as const;

type BlankKind = (typeof blankKinds)[number]["kind"];

const acceptTypes = "image/png,image/jpeg,image/webp,image/gif,.pdf,.csv,.md,.markdown,.txt,.html,.htm,.json";
const SEARCH_DEBOUNCE_MS = 200;
const DROP_FLASH_MS = 900;

type DragItem =
  | { type: "document"; id: string }
  | { type: "folder"; id: string };

export function DocumentsLibrary({ library }: { readonly library: DocumentLibrary }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const loadLibraryRef = useRef<(folderId?: string | null) => Promise<void>>(async () => undefined);
  const searchTimer = useRef<number>(undefined);
  const searchAbort = useRef<AbortController>(undefined);
  const searchSeq = useRef(0);
  const dropFlashTimer = useRef<number>(undefined);
  const [folder, setFolder] = useState(library.folder);
  const [ancestors, setAncestors] = useState(library.ancestors);
  const [folders, setFolders] = useState(library.folders);
  const [items, setItems] = useState(library.documents);
  const [allFolders, setAllFolders] = useState<ClientFolder[]>([]);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<DocumentSearchHit[]>();
  const [createOpen, setCreateOpen] = useState(false);
  const [folderOpen, setFolderOpen] = useState(false);
  const [editingFolder, setEditingFolder] = useState<ClientFolder>();
  const [folderName, setFolderName] = useState("");
  const [folderDescription, setFolderDescription] = useState("");
  const [creating, setCreating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [dragItem, setDragItem] = useState<DragItem>();
  const [dropTarget, setDropTarget] = useState<string | null>();
  const [droppedTarget, setDroppedTarget] = useState<string | null>();
  const [pendingDelete, setPendingDelete] = useState<ClientDocument>();
  const [pendingFolderDelete, setPendingFolderDelete] = useState<ClientFolder>();
  const [movingDocument, setMovingDocument] = useState<ClientDocument>();
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string>();

  const currentFolderId = folder?.id ?? null;

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync library from the server page
    setFolder(library.folder);
    setAncestors(library.ancestors);
    setFolders(library.folders);
    setItems(library.documents);
  }, [library]);

  useEffect(() => {
    return () => {
      if (searchTimer.current) window.clearTimeout(searchTimer.current);
      if (dropFlashTimer.current) window.clearTimeout(dropFlashTimer.current);
      searchAbort.current?.abort();
    };
  }, []);

  const applyLibrary = (next: DocumentLibrary) => {
    setFolder(next.folder);
    setAncestors(next.ancestors);
    setFolders(next.folders);
    setItems(next.documents);
  };

  const loadLibrary = async (folderId?: string | null) => {
    const params = folderId ? `?folderId=${encodeURIComponent(folderId)}` : "";
    const response = await fetch(`/api/documents${params}`);
    if (!response.ok) {
      setError("Unable to open that folder.");
      return;
    }
    applyLibrary((await response.json()) as DocumentLibrary);
  };
  // eslint-disable-next-line react-hooks/refs -- latest loader for popstate
  loadLibraryRef.current = loadLibrary;

  const openFolder = (folderId?: string | null) => {
    setQuery("");
    setResults(undefined);
    pushClientUrl(folderId ? `/files?folder=${folderId}` : "/files");
    void loadLibrary(folderId);
  };

  useEffect(() => {
    const onPopState = () => {
      if (window.location.pathname !== "/files") return;
      const folderId = new URLSearchParams(window.location.search).get("folder");
      setQuery("");
      setResults(undefined);
      void loadLibraryRef.current(folderId);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const searchLibrary = async (value: string) => {
    const trimmed = value.trim();
    const seq = ++searchSeq.current;
    searchAbort.current?.abort();
    if (!trimmed) {
      setResults(undefined);
      setSearching(false);
      return;
    }
    const controller = new AbortController();
    searchAbort.current = controller;
    setSearching(true);
    try {
      const response = await fetch(`/api/documents?q=${encodeURIComponent(trimmed)}`, {
        signal: controller.signal,
      });
      if (seq !== searchSeq.current) return;
      setSearching(false);
      if (!response.ok) {
        setError("Unable to search files.");
        return;
      }
      const payload = (await response.json()) as { results: DocumentSearchHit[] };
      if (seq !== searchSeq.current) return;
      setResults(payload.results);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      if (seq !== searchSeq.current) return;
      setSearching(false);
      setError("Unable to search files.");
    }
  };

  const onSearchChange = (value: string) => {
    setQuery(value);
    setError(undefined);
    if (searchTimer.current) window.clearTimeout(searchTimer.current);
    if (!value.trim()) {
      searchAbort.current?.abort();
      searchSeq.current += 1;
      setResults(undefined);
      setSearching(false);
      return;
    }
    searchTimer.current = window.setTimeout(() => {
      void searchLibrary(value);
    }, SEARCH_DEBOUNCE_MS);
  };

  const createBlank = async (kind: BlankKind) => {
    setCreating(true);
    setError(undefined);
    const response = await fetchJson("/api/documents", "POST", {
      content: kind === "csv" ? "Column 1,Column 2\n," : "",
      folderId: currentFolderId,
      kind,
      title: kind === "csv" ? "Untitled spreadsheet" : "Untitled file",
    });
    setCreating(false);
    if (!response.ok) {
      setError("Unable to create that file.");
      return;
    }
    const payload = (await response.json()) as { document: ClientDocument };
    setCreateOpen(false);
    router.push(payload.document.href);
  };

  const uploadFiles = async (files: FileList | File[] | null) => {
    const list = files ? Array.from(files) : [];
    if (list.length === 0) return;
    if (list.some((file) => file.size > MAX_DOCUMENT_BYTES)) {
      setError(UPLOAD_FILE_ERROR);
      return;
    }
    setUploading(true);
    setError(undefined);
    try {
      const result = await postLibraryUploads(list, {
        folderId: currentFolderId,
        onDocument: (document) => {
          setItems((current) => [document, ...current.filter((item) => item.id !== document.id)]);
        },
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      setCreateOpen(false);
    } finally {
      setUploading(false);
      setDragging(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const saveFolder = async () => {
    const name = folderName.trim();
    if (!name) {
      setError("A folder name is required.");
      return;
    }
    setCreating(true);
    setError(undefined);
    const response = await fetchJson(
      editingFolder ? `/api/folders/${editingFolder.id}` : "/api/folders",
      editingFolder ? "PATCH" : "POST",
      {
        name,
        description: folderDescription,
        parentId: editingFolder ? editingFolder.parentId : currentFolderId,
      },
    );
    setCreating(false);
    if (!response.ok) {
      setError("Unable to save that folder.");
      return;
    }
    setFolderOpen(false);
    setEditingFolder(undefined);
    await loadLibrary(currentFolderId);
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    setError(undefined);
    try {
      const response = await fetch(`/api/documents/${pendingDelete.id}`, { method: "DELETE" });
      if (!response.ok) {
        setError("Unable to delete this file.");
        return;
      }
      setItems((current) => current.filter((item) => item.id !== pendingDelete.id));
      setResults((current) => current?.filter((hit) => hit.document?.id !== pendingDelete.id));
      setPendingDelete(undefined);
    } finally {
      setDeleting(false);
    }
  };

  const confirmFolderDelete = async () => {
    if (!pendingFolderDelete) return;
    setDeleting(true);
    setError(undefined);
    try {
      const response = await fetch(`/api/folders/${pendingFolderDelete.id}`, { method: "DELETE" });
      if (!response.ok) {
        setError("Unable to delete this folder.");
        return;
      }
      setPendingFolderDelete(undefined);
      await loadLibrary(currentFolderId);
    } finally {
      setDeleting(false);
    }
  };

  const moveDocument = async (documentId: string, folderId: string | null) => {
    const response = await fetchJson(`/api/documents/${documentId}`, "PATCH", { folderId });
    if (!response.ok) {
      setError("Unable to move that file.");
      return false;
    }
    setMovingDocument(undefined);
    if (results) {
      void searchLibrary(query);
    } else {
      await loadLibrary(currentFolderId);
    }
    return true;
  };

  const moveFolder = async (folderId: string, parentId: string | null) => {
    const response = await fetchJson(`/api/folders/${folderId}`, "PATCH", { parentId });
    if (!response.ok) {
      setError("Unable to move that folder.");
      return;
    }
    await loadLibrary(currentFolderId);
  };

  const loadMoveTargets = async () => {
    const response = await fetch("/api/folders");
    if (!response.ok) return;
    const payload = (await response.json()) as { folders: ClientFolder[] };
    setAllFolders(payload.folders);
  };

  const onDragOverUpload = (event: DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (!uploading && !creating && !dragItem) setDragging(true);
  };

  const onDragLeaveUpload = (event: DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setDragging(false);
  };

  const onDropUpload = (event: DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setDragging(false);
    if (uploading || creating || dragItem) return;
    void uploadFiles(event.dataTransfer.files);
  };

  const canDropOn = (targetId: string | null) => {
    if (!dragItem) return false;
    if (dragItem.type === "folder" && dragItem.id === targetId) return false;
    if (dragItem.type === "document") {
      const document = items.find((item) => item.id === dragItem.id);
      return (document?.folderId ?? null) !== targetId;
    }
    return true;
  };

  const flashDropped = (targetId: string | null) => {
    if (dropFlashTimer.current) window.clearTimeout(dropFlashTimer.current);
    setDroppedTarget(targetId === null ? "" : targetId);
    dropFlashTimer.current = window.setTimeout(() => {
      setDroppedTarget(undefined);
    }, DROP_FLASH_MS);
  };

  const handleDropOn = (targetId: string | null) => {
    if (!dragItem || !canDropOn(targetId)) return;
    const item = dragItem;
    setDragItem(undefined);
    setDropTarget(undefined);
    flashDropped(targetId);

    if (item.type === "document") {
      const previousItems = items;
      const previousFolders = folders;
      const previousResults = results;
      setItems((current) => current.filter((document) => document.id !== item.id));
      if (targetId) {
        setFolders((current) =>
          current.map((folder) =>
            folder.id === targetId ? { ...folder, fileCount: folder.fileCount + 1 } : folder,
          ),
        );
        setResults((current) =>
          current?.map((hit) =>
            hit.folder?.id === targetId
              ? { ...hit, folder: { ...hit.folder, fileCount: hit.folder.fileCount + 1 } }
              : hit,
          ),
        );
      }
      void moveDocument(item.id, targetId).then((ok) => {
        if (ok) return;
        setItems(previousItems);
        setFolders(previousFolders);
        setResults(previousResults);
        setDroppedTarget(undefined);
      });
      return;
    }

    void moveFolder(item.id, targetId);
  };

  const searchingNow = Boolean(query.trim());
  const showResults = searchingNow && results !== undefined;
  const emptyLibrary = folders.length === 0 && items.length === 0;

  return (
    <div className="flex min-h-dvh flex-col bg-background pb-[env(safe-area-inset-bottom)]">
      <AppHeader />
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 pt-8 pb-20" id="main" tabIndex={-1}>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h1 className="text-pretty font-medium text-lg tracking-tight">Files</h1>
            <p className="text-muted-foreground text-sm">
              New files are private by default. 
              Sharing makes it viewable to users. Public makes it viewable to anyone.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              type="button"
              variant="outline"
              onClick={() => {
                setEditingFolder(undefined);
                setFolderName("");
                setFolderDescription("");
                setFolderOpen(true);
              }}
            >
              <FolderPlusIcon />
              New folder
            </Button>
            <Button size="sm" type="button" onClick={() => setCreateOpen(true)}>
              <FilePlus2Icon />
              New file
            </Button>
          </div>
        </div>

        <div className="relative">
          <SearchIcon
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            aria-label="Search files"
            className="bg-white pl-9 dark:bg-input/30"
            placeholder="Search by file name or describe the file…"
            value={query}
            onChange={(event) => onSearchChange(event.target.value)}
          />
        </div>

        {!searchingNow ? (
          <nav aria-label="Folder path" className="flex flex-wrap items-center gap-1 text-sm">
            <DropCrumb
              active={dropTarget === ""}
              current={!folder}
              dropped={droppedTarget === ""}
              label="All files"
              onClick={() => openFolder(null)}
              onDragLeave={() => setDropTarget(undefined)}
              onDragOver={() => {
                if (canDropOn(null)) setDropTarget("");
              }}
              onDrop={() => handleDropOn(null)}
            />
            {ancestors.map((crumb) => (
              <DropCrumb
                active={dropTarget === crumb.id}
                dropped={droppedTarget === crumb.id}
                key={crumb.id}
                label={crumb.name}
                onClick={() => openFolder(crumb.id)}
                onDragLeave={() => setDropTarget(undefined)}
                onDragOver={() => {
                  if (canDropOn(crumb.id)) setDropTarget(crumb.id);
                }}
                onDrop={() => handleDropOn(crumb.id)}
              />
            ))}
            {folder ? (
              <span className="font-medium text-foreground">{folder.name}</span>
            ) : null}
          </nav>
        ) : (
          <p className="text-muted-foreground text-sm">
            {searching || results === undefined
              ? "Searching…"
              : `${results.length} matching files and folders`}
          </p>
        )}

        {folder?.description && !searchingNow ? (
          <p className="text-muted-foreground text-sm">{folder.description}</p>
        ) : null}

        {error ? (
          <p className="text-destructive text-sm" role="alert">
            {error}
          </p>
        ) : null}

        {showResults ? (
          results.length === 0 ? (
            <div className="rounded-xl border bg-white/30 dark:bg-black/30 px-4 py-16 text-center text-muted-foreground text-sm">
              No files or folders match that search.
            </div>
          ) : (
            <LibraryList>
              {results.map((hit, index) =>
                hit.folder ? (
                  <FolderRow
                    dropActive={dropTarget === hit.folder.id}
                    dropped={droppedTarget === hit.folder.id}
                    folder={hit.folder}
                    key={`search-folder-${hit.folder.id}`}
                    match={hit.match}
                    showDivider={index > 0}
                    onDelete={() => setPendingFolderDelete(hit.folder)}
                    onDragEnd={() => {
                      setDragItem(undefined);
                      setDropTarget(undefined);
                    }}
                    onDragLeave={() => setDropTarget(undefined)}
                    onDragOver={() => {
                      if (canDropOn(hit.folder?.id ?? null)) setDropTarget(hit.folder?.id);
                    }}
                    onDragStart={() => setDragItem({ type: "folder", id: hit.folder!.id })}
                    onDrop={() => handleDropOn(hit.folder!.id)}
                    onEdit={() => {
                      setEditingFolder(hit.folder);
                      setFolderName(hit.folder!.name);
                      setFolderDescription(hit.folder!.description);
                      setFolderOpen(true);
                    }}
                    onOpen={() => openFolder(hit.folder!.id)}
                  />
                ) : hit.document ? (
                  <DocumentRow
                    document={hit.document}
                    key={`search-doc-${hit.document.id}`}
                    match={hit.match}
                    showDivider={index > 0}
                    showPath
                    onDelete={() => setPendingDelete(hit.document)}
                    onDragEnd={() => {
                      setDragItem(undefined);
                      setDropTarget(undefined);
                    }}
                    onDragStart={() => setDragItem({ type: "document", id: hit.document!.id })}
                    onMove={() => {
                      setMovingDocument(hit.document);
                      void loadMoveTargets();
                    }}
                  />
                ) : null,
              )}
            </LibraryList>
          )
        ) : emptyLibrary ? (
          <div className="rounded-xl border bg-white/30 dark:bg-black/30 px-4 py-16 text-center text-muted-foreground text-sm">
            {folder
              ? "This folder is empty. Create a file or another folder."
              : "No files yet. Create a folder, upload something, or ask the agent to draft a note."}
          </div>
        ) : (
          <LibraryList>
            {folders.map((item, index) => (
              <FolderRow
                dropActive={dropTarget === item.id}
                dropped={droppedTarget === item.id}
                folder={item}
                key={item.id}
                showDivider={index > 0}
                onDelete={() => setPendingFolderDelete(item)}
                onDragEnd={() => {
                  setDragItem(undefined);
                  setDropTarget(undefined);
                }}
                onDragLeave={() => setDropTarget(undefined)}
                onDragOver={() => {
                  if (canDropOn(item.id)) setDropTarget(item.id);
                }}
                onDragStart={() => setDragItem({ type: "folder", id: item.id })}
                onDrop={() => handleDropOn(item.id)}
                onEdit={() => {
                  setEditingFolder(item);
                  setFolderName(item.name);
                  setFolderDescription(item.description);
                  setFolderOpen(true);
                }}
                onOpen={() => openFolder(item.id)}
              />
            ))}
            {items.map((document, index) => (
              <DocumentRow
                document={document}
                key={document.id}
                showDivider={folders.length > 0 || index > 0}
                onDelete={() => setPendingDelete(document)}
                onDragEnd={() => {
                  setDragItem(undefined);
                  setDropTarget(undefined);
                }}
                onDragStart={() => setDragItem({ type: "document", id: document.id })}
                onMove={() => {
                  setMovingDocument(document);
                  void loadMoveTargets();
                }}
              />
            ))}
          </LibraryList>
        )}
      </main>

      <Dialog
        onOpenChange={(open) => {
          if (creating || uploading) return;
          setCreateOpen(open);
          if (!open) {
            setDragging(false);
            setError(undefined);
          }
        }}
        open={createOpen}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New file</DialogTitle>
            <DialogDescription>
              Create a blank file to open in the matching editor, or upload one you already have.
              {folder ? ` It will be saved in ${folder.name}.` : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            {error ? (
              <p className="text-destructive text-sm" role="alert">
                {error}
              </p>
            ) : null}
            <div className="flex flex-col gap-2">
              <p className="font-medium text-sm">Create from scratch</p>
              <div className="grid grid-cols-2 gap-2">
                {blankKinds.map((item) => (
                  <Button
                    disabled={creating || uploading}
                    key={item.kind}
                    type="button"
                    variant="outline"
                    onClick={() => void createBlank(item.kind)}
                  >
                    {item.label}
                  </Button>
                ))}
              </div>
            </div>
            <Separator />
            <div className="flex flex-col gap-2">
              <p className="font-medium text-sm">Upload a file</p>
              <input
                accept={acceptTypes}
                className="sr-only"
                disabled={creating || uploading}
                id="document-upload"
                multiple
                onChange={(event) => void uploadFiles(event.target.files)}
                ref={inputRef}
                type="file"
              />
              <button
                className={cn(
                  "flex min-h-40 w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-8 text-center text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50",
                  dragging
                    ? "border-foreground bg-accent/40 text-foreground"
                    : "border-border text-muted-foreground hover:border-foreground/40 hover:bg-accent/20",
                )}
                disabled={creating || uploading}
                onClick={() => inputRef.current?.click()}
                onDragLeave={onDragLeaveUpload}
                onDragOver={onDragOverUpload}
                onDrop={onDropUpload}
                type="button"
              >
                <UploadIcon aria-hidden="true" className="size-6" />
                <span className="font-medium text-foreground">
                  {uploading ? "Uploading…" : "Drop a file here"}
                </span>
                <span>{uploading ? "Please wait while the file is added." : "or click to browse your files"}</span>
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        onOpenChange={(open) => {
          if (creating) return;
          setFolderOpen(open);
          if (!open) setEditingFolder(undefined);
        }}
        open={folderOpen}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editingFolder ? "Edit folder" : "New folder"}</DialogTitle>
            <DialogDescription>
              Name the folder and optionally describe the kinds of files that belong in it.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="folder-name">Name</Label>
              <Input
                id="folder-name"
                value={folderName}
                onChange={(event) => setFolderName(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="folder-description">Description</Label>
              <Textarea
                id="folder-description"
                placeholder="What kinds of files belong here?"
                value={folderDescription}
                onChange={(event) => setFolderDescription(event.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              disabled={creating}
              type="button"
              variant="outline"
              onClick={() => setFolderOpen(false)}
            >
              Cancel
            </Button>
            <Button disabled={creating} type="button" onClick={() => void saveFolder()}>
              {creating ? "Saving…" : editingFolder ? "Save" : "Create folder"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        onOpenChange={(open) => {
          if (!open) setMovingDocument(undefined);
        }}
        open={movingDocument !== undefined}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Move “{movingDocument?.title}”</DialogTitle>
            <DialogDescription>Choose a folder, or keep the file at the top level.</DialogDescription>
          </DialogHeader>
          <div className="flex max-h-80 flex-col gap-1 overflow-y-auto">
            <Button
              className="justify-start"
              type="button"
              variant={(movingDocument?.folderId ?? null) === null ? "secondary" : "ghost"}
              onClick={() => movingDocument && void moveDocument(movingDocument.id, null)}
            >
              All files
            </Button>
            {allFolders.map((item) => (
              <Button
                className="justify-start"
                key={item.id}
                type="button"
                variant={movingDocument?.folderId === item.id ? "secondary" : "ghost"}
                onClick={() => movingDocument && void moveDocument(movingDocument.id, item.id)}
              >
                {item.path}
              </Button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog
        onOpenChange={(open) => {
          if (!open && !deleting) setPendingDelete(undefined);
        }}
        open={pendingDelete !== undefined}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this file?</AlertDialogTitle>
            <AlertDialogDescription>
              The file is removed from your library and any public link stops working.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              onClick={(event) => {
                event.preventDefault();
                void confirmDelete();
              }}
              variant="destructive"
            >
              {deleting ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        onOpenChange={(open) => {
          if (!open && !deleting) setPendingFolderDelete(undefined);
        }}
        open={pendingFolderDelete !== undefined}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this folder?</AlertDialogTitle>
            <AlertDialogDescription>
              Files and folders inside it move up one level. The folder itself is removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              onClick={(event) => {
                event.preventDefault();
                void confirmFolderDelete();
              }}
              variant="destructive"
            >
              {deleting ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function LibraryList({ children }: { readonly children: React.ReactNode }) {
  return <div className="overflow-hidden rounded-xl border bg-white/30 dark:bg-black/30">{children}</div>;
}

function DropCrumb({
  active,
  current,
  dropped,
  label,
  onClick,
  onDragLeave,
  onDragOver,
  onDrop,
}: {
  readonly active?: boolean;
  readonly current?: boolean;
  readonly dropped?: boolean;
  readonly label: string;
  readonly onClick: () => void;
  readonly onDragLeave: () => void;
  readonly onDragOver: () => void;
  readonly onDrop: () => void;
}) {
  if (current) {
    return <span className="font-medium text-foreground">{label}</span>;
  }
  return (
    <>
      <button
        className={cn(
          "rounded-md px-1.5 py-0.5 text-muted-foreground transition-[background-color,box-shadow,color,transform] duration-200 hover:bg-accent hover:text-foreground",
          active && "scale-[1.03] bg-primary/15 text-foreground ring-2 ring-primary/50",
          dropped && "bg-primary text-primary-foreground ring-2 ring-primary",
        )}
        type="button"
        onClick={onClick}
        onDragLeave={(event) => {
          const next = event.relatedTarget;
          if (next instanceof Node && event.currentTarget.contains(next)) return;
          onDragLeave();
        }}
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          onDragOver();
        }}
        onDrop={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onDrop();
        }}
      >
        {dropped ? "Moved here" : active ? `Drop in ${label}` : label}
      </button>
      <span aria-hidden className="text-muted-foreground">
        /
      </span>
    </>
  );
}

function FolderRow({
  dropActive,
  dropped,
  folder,
  match,
  showDivider,
  onDelete,
  onDragEnd,
  onDragLeave,
  onDragOver,
  onDragStart,
  onDrop,
  onEdit,
  onOpen,
}: {
  readonly dropActive?: boolean;
  readonly dropped?: boolean;
  readonly folder: ClientFolder;
  readonly match?: DocumentSearchHit["match"];
  readonly showDivider: boolean;
  readonly onDelete: () => void;
  readonly onDragEnd: () => void;
  readonly onDragLeave: () => void;
  readonly onDragOver: () => void;
  readonly onDragStart: () => void;
  readonly onDrop: () => void;
  readonly onEdit: () => void;
  readonly onOpen: () => void;
}) {
  const Icon = dropActive || dropped ? FolderOpenIcon : FolderIcon;
  return (
    <div>
      {showDivider ? <div className="h-px bg-border" /> : null}
      <div
        className={cn(
          "group relative transition-[background-color,box-shadow,transform] duration-200",
          dropActive && "z-10 bg-primary/10 shadow-[inset_0_0_0_2px] shadow-primary/60",
          dropped && "z-10 bg-primary/15 shadow-[inset_0_0_0_2px] shadow-primary",
        )}
        onDragLeave={(event) => {
          const next = event.relatedTarget;
          if (next instanceof Node && event.currentTarget.contains(next)) return;
          onDragLeave();
        }}
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          onDragOver();
        }}
        onDrop={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onDrop();
        }}
      >
        <button
          aria-label={`Open folder ${folder.name}, ${fileCountLabel(folder.fileCount)}`}
          className={cn(
            "flex w-full items-start gap-3 px-4 py-3.5 pr-12 text-left transition-colors",
            !dropActive && !dropped && "hover:bg-accent/40",
          )}
          draggable
          type="button"
          onClick={onOpen}
          onDragEnd={onDragEnd}
          onDragStart={(event) => {
            event.dataTransfer.setData("text/plain", folder.id);
            event.dataTransfer.effectAllowed = "move";
            onDragStart();
          }}
        >
          <Icon
            aria-hidden="true"
            className={cn(
              "mt-0.5 size-4 shrink-0 transition-colors",
              dropActive || dropped ? "text-primary" : "text-muted-foreground",
            )}
          />
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex min-w-0 items-center gap-2">
              <p className="truncate font-medium text-sm">{folder.name}</p>
              <Badge
                variant={dropped ? "default" : "secondary"}
                className={cn("tabular-nums", dropped && "scale-105")}
              >
                {fileCountLabel(folder.fileCount)}
              </Badge>
              {dropActive ? <Badge>Drop here</Badge> : null}
              {dropped ? (
                <Badge className="gap-1">
                  <CheckIcon />
                  Moved
                </Badge>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-2 text-muted-foreground text-xs">
              {match ? <Badge variant="secondary">{matchLabel(match)}</Badge> : null}
              {folder.description ? <span className="truncate">{folder.description}</span> : <span>Folder</span>}
            </div>
          </div>
        </button>
        <RowMenu onDelete={onDelete} onEdit={onEdit} />
      </div>
    </div>
  );
}

function DocumentRow({
  document,
  match,
  showDivider,
  showPath,
  onDelete,
  onDragEnd,
  onDragStart,
  onMove,
}: {
  readonly document: ClientDocument;
  readonly match?: DocumentSearchHit["match"];
  readonly showDivider: boolean;
  readonly showPath?: boolean;
  readonly onDelete: () => void;
  readonly onDragEnd: () => void;
  readonly onDragStart: () => void;
  readonly onMove: () => void;
}) {
  return (
    <div>
      {showDivider ? <div className="h-px bg-border" /> : null}
      <div className="group relative">
        <Link
          className="flex items-start justify-between gap-4 px-4 py-3.5 pr-12 transition-colors hover:bg-accent/40"
          draggable
          href={document.href}
          onDragEnd={onDragEnd}
          onDragStart={(event) => {
            event.dataTransfer.setData("text/plain", document.id);
            event.dataTransfer.effectAllowed = "move";
            onDragStart();
          }}
        >
          <div className="flex min-w-0 flex-col gap-1">
            <p className="truncate font-medium text-sm">{document.title}</p>
            <div className="flex flex-wrap items-center gap-2 text-muted-foreground text-xs">
              <Badge variant="secondary">{documentKindLabel(document.kind)}</Badge>
              {match ? <Badge variant="outline">{matchLabel(match)}</Badge> : null}
              {visibilityBadgeLabel(document.visibility) ? (
                <Badge variant="outline">{visibilityBadgeLabel(document.visibility)}</Badge>
              ) : null}
              {showPath && document.folderPath ? <span>{document.folderPath}</span> : null}
              <span>{formatBytes(document.size)}</span>
              <span aria-hidden>·</span>
              <span suppressHydrationWarning>{formatRelativeTime(document.updatedAt)}</span>
            </div>
          </div>
        </Link>
        <RowMenu onDelete={onDelete} onMove={onMove} />
      </div>
    </div>
  );
}

function RowMenu({
  onDelete,
  onEdit,
  onMove,
}: {
  readonly onDelete?: () => void;
  readonly onEdit?: () => void;
  readonly onMove?: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label="Item actions"
          className="absolute top-2.5 right-3 opacity-70 group-hover:opacity-100"
          size="icon-xs"
          type="button"
          variant="ghost"
        >
          <MoreHorizontalIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {onEdit ? <DropdownMenuItem onClick={onEdit}>Edit folder</DropdownMenuItem> : null}
        {onMove ? <DropdownMenuItem onClick={onMove}>Move to folder</DropdownMenuItem> : null}
        {onDelete && (onEdit || onMove) ? <DropdownMenuSeparator /> : null}
        {onDelete ? (
          <DropdownMenuItem variant="destructive" onClick={onDelete}>
            <Trash2Icon />
            Delete
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function matchLabel(match: DocumentSearchHit["match"]) {
  if (match === "name") return "Name";
  if (match === "content") return "Contents";
  return "Similar";
}

function fileCountLabel(count: number) {
  return count === 1 ? "1 file" : `${count} files`;
}
