# Changelog

What changed in Jarvis that a fork should know about.

When you pull `main`, keep your customized [`app.config.ts`](./app.config.ts) — especially the `models` block. Brand, home copy, related-session and reminder-email floors, and skill enablement live in that file too. Secrets and who can sign in stay in `.env.local` / Vercel env. They are not in this repo.

The matching git tag is the baseline to sync against. Bump `package.json` when you tag the next release.

## 0.4.0 — 2026-11-05

Security
- `send_email` on an unattended reminder skips approval only when it goes to the account owner with no `cc`. Before, a reminder could add any `cc` without approval.
- The private plus-address no longer appears in the From of mail to other people. That mail comes from `RESEND_FROM_EMAIL` as "Name via Jarvis" with `Reply-To` set to the owner. **Rotate plus-addresses** (Settings → Inbox) if the agent has emailed outside contacts before this release.
- Server-to-self calls use a secret derived from `BETTER_AUTH_SECRET` (or `EMAIL_SESSION_SECRET`), compared in constant time. They no longer reuse `RESEND_WEBHOOK_SECRET` or send `BETTER_AUTH_SECRET` raw, and they never build URLs from the request Host header.
- eve sessions recorded on one user's chat can no longer be continued or streamed by another signed-in user. `PATCH /api/chats/:id` only writes title, description, session id, and stream index.
- Uploaded filenames are reduced to a single safe segment, and local blob paths must stay under `.data/blobs` (path traversal when Blob is not configured).
- User files are served inline only from an allowlist of types, with a sandboxing CSP. Everything else downloads.
- Sign-in, sign-up, verification resend, and the local setup writer reject cross-site posts. The setup writer rejects multi-line values.
- The agent sandbox has no outbound network by default (`security.sandboxNetwork` in `app.config.ts`).

Fixes
- An emailed request that cannot start right away is queued as a `/remind` follow-through instead of a plain nudge, so the work gets done once.
- A scheduled run whose session started is not released and re-fired when later bookkeeping fails.
- A unique index on `emails.resend_email_id` stops a webhook retry from starting a second session.
- `create_schedule` validates `firstRunAt` and uses the cadence's own first run for repeating jobs.

AI Gateway
- Voice input runs through AI Gateway (`models.transcription`, default `openai/gpt-transcribe`). `OPENAI_API_KEY` is no longer used.
- Deeper reasoning on the `reason` and `complex` routes works for Anthropic and xAI models as well as OpenAI.

## 0.3.0 — 2026-09-06

- Email verification on signup (Resend in production; local without Resend logs the link).
- Per-user inbound plus-address (Settings → Inbox). Workspace notices such as signup verification still use `RESEND_FROM_EMAIL`. Mail to a plus-address starts a session only when From is that user's account email.
- `/remind` one-off jobs: a nudge emails you, or a do-job checks prior work then emails you. Settings → Schedules has Run now. Scheduled runs stay hidden from Sessions until you include them.
- Scheduled jobs default to Hobby (at most once a day). Optional `VERCEL_TOKEN` plus a Pro/Enterprise billing plan unlocks hourly and minute-level jobs after a redeploy.
- Nudge reminder emails may attach one prior session and one file only when embeddings clear the reminder floors in `app.config.ts`.

## 0.2.0 — 2026-09-05

- Signed-in workspace setup at `/settings/setup` (Settings → Setup). Hide with `setup.inAppPage` in `app.config.ts`, or delete the isolated page files listed in the README.
- README leads with the Vercel Deploy button, plus home and session-canvas screenshots.

## 0.1.0 — 2026-09-05

First public version (`v0.1.0`).

- Deployable eve workspace: Next.js chat, Better Auth, Neon or local SQLite, AI Gateway models, skills, memory, files, inbox, usage, and scheduled jobs
- Setup checklist on `/` until `ALLOWED_SIGNUP_EMAILS` or `ALLOWED_SIGNUP_DOMAINS` is set
- Product defaults in `app.config.ts`; MIT license
