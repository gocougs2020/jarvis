---
name: files
description: >
  Use when the user already asked to save, share, or file something, or
  to reopen a file in their library. Do not load this before a
  first-pass chat draft unless the user invoked it with /files or
  /documents. Load immediately when they write /files or /documents.
---

# Files

Create durable files the user can edit, reopen, and share — notes, reports, intake briefs, plans, comparisons, tables, pages, uploads, or images. Session-generated records belong here (or in sticky-note memory only when they are durable preferences). Draft in chat first. Then offer to save. Do not call `create_document` before they have seen a first-pass answer unless they already asked to save or file it.

1. Choose the kind: `markdown` for reports and plans, `csv` for tables, `html` for a formatted page, `text` for plain notes, `json` for structured data.
2. After they have seen a draft — or they already asked to save — call `create_document` with a clear title and the full file contents. Attach it to this session unless they asked otherwise. If they named a folder, call `list_folders` and pass `folderId`. Create a folder with `create_folder` when they asked for a new one; include a short description of what belongs there.
3. Tell them the file title and that it is on the Files page and in the session canvas. New files are private. If they asked to share it on the internet, set `visibility: "public"` and give them the share URL (`/d/<shareId>`). Anyone with that link can view the file, but only the user can change or delete it.
4. To revise, call `read_document` and `update_document` in the same step when you already have the id. Do not create a duplicate unless they asked for a new version. Use `update_document` with `folderId` to file an existing file.
5. To reuse existing files, call `list_documents` with a name or a description of the file. It matches titles, filenames, contents, and similar files. Use `list_folders` when they asked about a folder.
6. To email a file, call `send_email` with `documentIds` after they ask to send. If they asked to email themselves, omit `to`. The copy is stored on Inbox.

## Quick start

If the user invoked this skill with `/files` or `/documents` and no extra brief, ask what they want to write or reopen, and whether it should be a note, report, table, or page. Draft in chat first unless they already asked to save.
