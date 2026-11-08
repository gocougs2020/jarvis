# Changelog

What changed in Jarvis that a fork should know about.

When you pull `main`, keep your customized [`app.config.ts`](./app.config.ts) — especially the `models` block. Brand, home copy, related-session and reminder-email floors, and skill enablement live in that file too. Secrets and who can sign in stay in `.env.local` / Vercel env. They are not in this repo. Easier: leave `app.config.ts` unmodified and put your changes in `NEXT_PUBLIC_APP_CONFIG` (see README → Per-deployment overrides), so pulls never conflict.

The matching git tag is the baseline to sync against. Bump `package.json` when you tag the next release.

## Unreleased

Realtime voice mode
- Voice mode is now a live speech-to-speech conversation with `models.realtime` (`spacexai/grok-voice-3.0`) over an AI Gateway WebSocket, separate from the agent. Nothing is transcribed into the chat or read back afterwards, and you can interrupt a reply by talking. It has no tools; it gets your name, saved memories, and Settings instructions.
- New route `/api/realtime` (instructions and a short-lived Gateway client secret). Removed `POST /api/speech` and the transcribe, send, then speak loop.
- In `app.config.ts`, `models.speech` is replaced by `models.realtime`, and `voice.speechVoice` / `voice.maxSpeechChars` by `voice.realtimeVoice`. **Update both when you merge** if you keep your own config, and drop them from `NEXT_PUBLIC_APP_CONFIG` if you set them there.
- New dependency `@ai-sdk/react` (for `experimental_useRealtime`).

Single-user Jarvis
- Jarvis now has exactly one account, the owner, named by the new `OWNER_EMAIL`. Only that address can create the account, sign in, or keep a session. Without it, nobody can sign up and the setup checklist stays on `/` (any host); only under `npm run dev` does the first sign-up become the owner. Once the account exists, `/sign-up` redirects to sign-in.
- **Set `OWNER_EMAIL`** to your own address before you deploy this version, then remove `ALLOWED_SIGNUP_EMAILS`, `ALLOWED_SIGNUP_DOMAINS`, `BLOCKED_ACCESS_EMAILS`, and `ALLOWED_ACCOUNT_USAGE_EMAILS`; they are no longer read. Any other account already in the database is locked out; its data stays untouched.
- Removed sharing between accounts. Files are private or public (`/d/...` link). Folders no longer have a visibility setting. Files and folders marked "shared" read as private; no migration is needed.
- Removed the Account tab and per-person breakdown on Usage.
- Inbound mail is filed for the owner (named by `OWNER_EMAIL`), not the oldest account. Sessions still start only from the owner's own address with a DMARC pass.

Per-deployment config and theming
- Any `app.config.ts` key can now be overridden per deployment with `NEXT_PUBLIC_APP_CONFIG` (JSON, deep-merged), plus `NEXT_PUBLIC_APP_NAME`, `NEXT_PUBLIC_APP_TAGLINE`, and `NEXT_PUBLIC_BRAND_COLOR` shortcuts. Unknown keys, wrong types, and unsafe CSS fail the build. A fork can keep `app.config.ts` identical to upstream.
- New `theme` block in `app.config.ts`: `brandColor`, `brandForeground`, `radius`, per-mode `light` / `dark` token overrides, `browserColor` (was hardcoded in `lib/pwa.ts`), and `icon` colors (were hardcoded in `lib/app-icon.tsx`). The defaults render exactly as before. **Add the block when you merge** if you keep your own config.
- Repository links point at `gocougs2020/jarvis` (were the old `morrow` name).

Email: one agent address
- The agent has one address, `RESEND_FROM_EMAIL` (for example `agent@yourdomain.com`). It sends from it and receives at it. Per-user plus-addresses (`agent+token@…`), address rotation, and `RESEND_INBOUND_ADDRESSES` / `RESEND_INBOUND_DOMAINS` are gone. **Remove those two variables**, and point anything that mailed an old plus-address at the agent address.
- Inbound mail is filed for the account whose email sent it, or for the workspace owner (the first account). (Superseded: see Single-user Jarvis.)
- Because the address is no longer secret, mail starts an unattended session only when From is an account email **and** the receiving server reports a DMARC pass for that domain. New `security.emailSessionsRequireDmarc` in `app.config.ts` (default `true`). **Add it when you merge** if you keep your own config.
- The `user_settings.inbound_mail_token` column is no longer used. Existing databases keep it; it is harmless.

Instant first reply and Resend inbox
- New `quickReply` block, `models.quickReply`, and `models.reasoning.quickReply` in `app.config.ts`: the first prompt of a chat gets an instant answer or a one-line hand-off before the agent starts. See README → Instant first reply.
- New `resendInbox` block in `app.config.ts`: host the agent address as a Resend inbox (Settings → Inbox), triaged by Resend's inbox agent, with new `inbox_threads`, `inbox_thread`, `inbox_reply`, and `inbox_organize` tools. Add `inbox.email.received` to the Resend webhook. `resend` is upgraded to 6.37.

Cost and speed
- The Neon schema bootstrap runs once per schema change instead of on every cold start (~85 sequential DDL round trips and a backfill `UPDATE` each time). A cold start now reads one row from `app_schema_version`.
- Chat transcripts are saved as checkpoints (every few seconds while streaming, once when the turn settles), writing only changed rows. Before, every streamed token was its own request, database write, and full re-read of the chat to recount usage. Runs of streaming deltas are collapsed before they are stored or loaded. Older chats are compacted on their next turn.
- A failing recurring schedule skips to its next slot instead of retrying (and writing to the database) on every dispatcher tick. A failing one-off retries every five minutes, then pauses after six hours.
- Turns start sooner: very short first prompts skip the routing model call, related-session recall skips trivial prompts and overlaps its chat lookup with the embedding calls, and the citations write no longer blocks the turn.

Voice
- `models.transcription` defaults to `spacexai/grok-stt` (was `openai/gpt-transcribe`).
- New `models.speech` (`spacexai/grok-tts`) and `voice` block (`speechVoice`, `maxSpeechChars`) in `app.config.ts`. **Add both when you merge** if you keep your own config.
- Voice mode: the waveform button next to the mic sends a recording as soon as it is transcribed and reads the reply aloud. New route `POST /api/speech`; usage is logged under "Voice replies".
- Voice mode is hands-free: turning it on starts listening right away, the recording is sent when you stop talking, and the composer shows a live waveform with Listening / Thinking / Speaking states. After the reply is read aloud it listens again. **End voice** turns it off.
- Spoken replies now play. The CSP had no `media-src`, so the browser blocked the `blob:` audio and the failure was silent. Replies now play through Web Audio, and `media-src 'self' blob:` is allowed for the fallback.

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
