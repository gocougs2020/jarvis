# Jarvis

[![CI](https://github.com/gocougs2020/jarvis/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/gocougs2020/jarvis/actions/workflows/ci.yml)

Jarvis is an opinionated but flexible, deployable workspace for quickly building AI agents. One deploy is one team workspace: files, sessions, memory, inbox, and usage are designed a certain way. Models, skills, connections, and instructions are yours to change.

Fork, configure, and deploy. Web chat, files, memory, skills, scheduled jobs, and inbox.

MIT licensed. Current tag is **0.4.0** — bump `package.json` when you tag the next release. See [CHANGELOG.md](./CHANGELOG.md) if you forked and are pulling updates, plus [CONTRIBUTING.md](./CONTRIBUTING.md), [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md), and [SECURITY.md](./SECURITY.md).

Product defaults live in **[`app.config.ts`](./app.config.ts)**. Secrets and who can sign in live in environment variables.

<p align="center">
  <img src="docs/screenshots/home.png" alt="Jarvis home: skill chips and a /write prompt" width="880" />
</p>

<p align="center">
  <img src="docs/screenshots/session-canvas.png" alt="A session with a live HTML file canvas beside the chat" width="880" />
</p>

## Features

- Durable sessions with stable URLs
- First-prompt model routing
- Durable and scalable memory (sticky notes + embeddings)
- Voice input, plus a hands-free voice mode that reads replies aloud
- Private file storage
- Inbox for agent mail (send and receive)
- Built-in and user-authored skills
- Slash-command skill invoke (`/slug`)
- Scheduled jobs, plus Run now in Settings. The default host plan is at most once a day. A Pro or Enterprise host plus `VERCEL_TOKEN` unlocks hourly and minute-level jobs after a redeploy. Each run is a session, hidden from Sessions until you include scheduled runs. `/remind` creates a one-off job: a nudge emails you (optional session/file context only if a tight embedding match clears the floor), or a do-job checks prior work then acts, then emails you with a link to that session and deletes the job.
- Installable PWA (Add to Home Screen)
- Session file canvas (files beside the chat)
- Automatic context compaction
- Usage and cost dashboard (token and cost ledger)
- Related-session citations (embeddings)
- Custom instruction overlay (on top of agent instructions)
- Single owner account (`OWNER_EMAIL`): one person, one login
- Email verification on signup (Resend; local without Resend logs the link)
- One-file product config (`app.config.ts`)

Jarvis is built on the open-source [eve](https://eve.dev) agent framework. You configure the product in `app.config.ts` and the `agent/` directory; you do not need eve-specific knowledge to deploy or use it.

**Jarvis is one person's agent.** There is exactly one account, the owner, named by `OWNER_EMAIL`. Nobody else can create an account or sign in, and everything (files, chats, memory, schedules, mail) belongs to that one account.

**How to hide the home setup screen.** Until you set `OWNER_EMAIL`, the home page is a setup checklist — locally and on the live site — and nobody can create an account on a hosted deploy. Completing the other steps (secret, Gateway, Neon, Blob) does not dismiss it. Add your email, restart `npm run dev` (or redeploy on Vercel), and that home-page checklist is gone. See [Name the owner](#name-the-owner). After you sign in, **Settings → Setup** still shows what’s left (voice, Inbox, and any unfinished host settings). To hide or delete that signed-in page, see [Remove the in-app setup page](#remove-the-in-app-setup-page).

## Quick start

**Deploy on Vercel** is the fastest path to a live workspace. Run it on your computer if you want to change the code first. Import the repo yourself if you already forked and do not want the Deploy button.

You need a [GitHub](https://github.com/signup) account and a [Vercel](https://vercel.com/signup) account (both free). About 10 minutes for the Deploy button.

**Settings files in one sentence.** Private values (passwords, API keys, who may sign in) are not stored in the public code. On your computer they go in a file named `.env.local`. On the live site they go in Vercel → your project → **Settings → Environment Variables**. The **Set up your workspace** checklist is environment-specific: `npm run dev` asks for `.env.local` values; the production URL asks for the Vercel project variables that are actually missing.

### Deploy on Vercel (recommended)

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fgocougs2020%2Fjarvis&project-name=jarvis&repository-name=jarvis&env=BETTER_AUTH_SECRET%2CBETTER_AUTH_URL%2COWNER_EMAIL&envDescription=BETTER_AUTH_SECRET%3A+32%2B+random+characters.+BETTER_AUTH_URL%3A+your+live+origin+including+https%3A%2F%2F+%28https%3A%2F%2FYOUR-PROJECT.vercel.app%29.+OWNER_EMAIL%3A+your+email+-+the+one+account+that+can+sign+in.+Hides+the+setup+page.&envLink=https%3A%2F%2Fgithub.com%2Fgocougs2020%2Fjarvis%23environment-variables&stores=%5B%7B%22type%22%3A%22integration%22%2C%22integrationSlug%22%3A%22neon%22%2C%22productSlug%22%3A%22neon%22%2C%22protocol%22%3A%22storage%22%2C%22allowConnectExistingProduct%22%3Atrue%7D%2C%7B%22type%22%3A%22blob%22%2C%22access%22%3A%22private%22%7D%5D)

The button copies this repo into your GitHub account and creates a Vercel project. The wizard asks you to type three values (it cannot fill secrets for you — they would sit in the browser history) and offers Neon plus private Blob:

| Name | What to type |
| --- | --- |
| `BETTER_AUTH_SECRET` | 32+ random characters. Treat it like a password; do not commit it. |
| `BETTER_AUTH_URL` | Your live origin, including `https://`. Use `https://YOUR-PROJECT.vercel.app` (the project name you pick, default `jarvis`) or your custom domain. You can fix this in Settings after the first deploy if the URL is not known yet. |
| `OWNER_EMAIL` | Your email. Jarvis has one account, and only this address can create it and sign in. It also hides the setup checklist. |

Accept Neon and **private** Blob when offered. A linked Vercel project can call models with OIDC, so you do not have to paste `AI_GATEWAY_API_KEY` here.

After deploy, open the site URL, create your account with `OWNER_EMAIL`, and confirm the verification email. If you skipped a store or an env field, finish [Import the repo yourself](#import-the-repo-yourself) and redeploy.

You can also deploy from a terminal after `npm install` — see [Deploy to Vercel](#deploy-to-vercel).

### Run it on your computer

1. **Node.js 24** — download the installer whose version starts with **24** from [nodejs.org](https://nodejs.org). This also installs `npm`.
2. **Git** (optional if you download a ZIP) — [git-scm.com/downloads](https://git-scm.com/downloads).

On a Mac, open **Terminal** (Applications → Utilities → Terminal). On Windows, open **Terminal** or **PowerShell**.

**Easiest:** open [github.com/gocougs2020/jarvis](https://github.com/gocougs2020/jarvis), click **Fork** (top right) so you have your own copy, then click the green **Code** button → **Download ZIP**. Unzip the folder. In Terminal, type `cd ` (with a space), drag the unzipped folder onto the window, and press Return.

**Or use Git** (replace `YOUR-USERNAME` with your GitHub name if you forked):

```bash
git clone https://github.com/gocougs2020/jarvis.git
cd jarvis
```

If you forked first, clone `https://github.com/YOUR-USERNAME/jarvis.git` instead.

Then install and create your private settings file:

```bash
npm install
```

Mac / Linux:

```bash
cp .env.example .env.local
```

Windows (PowerShell):

```powershell
Copy-Item .env.example .env.local
```

Start the app:

```bash
npm run dev
```

Leave that window open. Open [http://localhost:3000](http://localhost:3000) in your browser. You should see **Set up your workspace** — a checklist. Click **Refresh** on the page after you add a setting (if you edited `.env.local` yourself, press Ctrl+C in Terminal, run `npm run dev` again, then Refresh).

**Sign-in secret.** On the setup page, click **Generate secret**, then **Copy**. Click **Save to this computer**, or paste `BETTER_AUTH_SECRET=` plus the value into `.env.local`. Do not commit it.

**AI Gateway key.** The agent needs a Vercel AI Gateway key to call models locally.

1. Sign up at [vercel.com/signup](https://vercel.com/signup) if you do not have an account.
2. Create a key at [AI Gateway API keys](https://vercel.com/d?to=%2F%5Bteam%5D%2F%7E%2Fai%2Fapi-keys&title=Get%20your%20AI%20Gateway%20key).
3. In `.env.local`, put it on the `AI_GATEWAY_API_KEY=` line. Restart `npm run dev` and Refresh the checklist.

On a linked Vercel project, OIDC can replace this key.

Then [name the owner](#name-the-owner) so the checklist leaves the home page.

### Import the repo yourself

Use this if you forked and imported on [vercel.com/new](https://vercel.com/new) instead of the Deploy button. Skip any step the wizard already completed.

1. Fork [github.com/gocougs2020/jarvis](https://github.com/gocougs2020/jarvis) if you have not already.
2. Open [vercel.com/new](https://vercel.com/new), sign in with GitHub, and **Import** your fork. Deploy and copy the site URL (it looks like `https://something.vercel.app`).
3. In that Vercel project → **Settings → Environment Variables**, add at least:

   | Name | Value |
   | --- | --- |
   | `BETTER_AUTH_SECRET` | 32+ random characters |
   | `BETTER_AUTH_URL` | Your live URL, including `https://` |
   | `AI_GATEWAY_API_KEY` | Your Gateway key (skip if you rely on OIDC) |
   | `OWNER_EMAIL` | Your email: the one account that can sign in |

4. **Neon** — Storage → Create Database → Neon, or [Neon on the Vercel Marketplace](https://vercel.com/marketplace/neon). Vercel adds `DATABASE_URL`. The live site needs this so accounts and chats survive deploys. Locally a file under `.data/` is used instead.
5. **Blob** — Storage → Create → Blob, **private**. Vercel adds `BLOB_READ_WRITE_TOKEN`. Uploads and some memory notes need this on the live site.
6. Redeploy (Deployments → ⋯ → Redeploy) so those settings take effect.

On the live site the setup page lists Vercel project settings (public URL, Neon, Blob, and the owner's email). It does not ask you to create `.env.local`.

### Name the owner

This is the only setting that removes the setup screen. Set `OWNER_EMAIL` to your address (`you@example.com`). Jarvis then has exactly one account:

- only that address can create the account, sign in, or keep a session;
- once the account exists, the sign-up page redirects to sign-in;
- on a hosted deploy without `OWNER_EMAIL`, nobody can create an account at all, so a fresh public URL can't be claimed by whoever finds it first.

Locally (`npm run dev`) without `OWNER_EMAIL`, the first sign-up becomes the owner and sign-up closes behind it.

- **On this computer:** enter your email on the last checklist item and click **Save and hide this page**. That writes `OWNER_EMAIL` into `.env.local`. Or add the line yourself, stop the app, and run `npm run dev` again.
- **On Vercel:** skip this if you already entered it in the Deploy button wizard. Otherwise Settings → Environment Variables → add `OWNER_EMAIL`, then redeploy.

After that, the setup page is gone. Open the site, create your account, and confirm the verification email. Production sends that link through Resend (`RESEND_API_KEY`). Local `npm run dev` without Resend prints the link in the server log.

Voice input needs nothing extra: it runs through AI Gateway like chat. Optional later: the rest of the `RESEND_*` keys for Inbox — see [Environment variables](#environment-variables).

Signup, sign-in, transcription, and a few generate routes are rate-limited per server instance. That is a burst brake, not a global quota — the single owner account is the real spend control.

When you want to change the product name, home-page chips, or models, edit `app.config.ts` (details below). Do not put emails, domains, or API keys in that file. Restart or redeploy after you change it.

## After the first deploy

The **Set up your workspace** page on `/` stays up until `OWNER_EMAIL` is set in that environment (`.env.local` on your computer, Vercel env on the live site). Locally the list is secret, AI Gateway key, and owner email. On Vercel it is the project env that production needs. Other completed checklist items do not hide it. Then the home page is signed-in chat.

After you sign in you can still open **Settings → Setup** (`/settings/setup`) to see remaining environment settings — Inbox (`RESEND_*`) and any unfinished host steps. The page never prints secret values.

## Remove the in-app setup page

The signed-in checklist is optional after you are done configuring.

1. **Hide it** — set `setup.inAppPage` to `false` in [`app.config.ts`](./app.config.ts), then restart or redeploy. The route 404s and the Setup links disappear.
2. **Delete it from the repo** — remove `app/settings/setup/` and `components/workspace-setup.tsx`, drop the `setup` block from `app.config.ts` and `isInAppSetupEnabled` from `lib/in-app-setup.ts` (and its imports), and take the Setup links out of `components/app-header.tsx`, `components/settings-panel.tsx`, and `lib/app-nav.ts`.

Leave `lib/setup-status.ts` and the public checklist on `/` in place. Those still protect a fresh clone until `OWNER_EMAIL` is set.

## What’s included

- Signed-in web chat at `/`, with sessions under `/s/[chatId]`
- Files you can edit, attach to a session, and share (uploads up to 15 MB; markdown, CSV, JSON, PDF, PNG, JPEG, WebP, GIF, and HTML)
- Inbox for mail the agent sends or receives through Resend, with search. The agent has one address, `RESEND_FROM_EMAIL` (for example `agent@yourdomain.com`). Mail it sends to you comes from that address; mail to anyone else comes from it as "Your Name via Jarvis" with replies going to your own inbox. Inbound mail is stored as HTML and plain text and embedded for later search. Unattended sessions start only from your account email, and only when it passes DMARC.
- Built-in skills for work, home, and a couple of creative examples (research, writing, meeting prep, household plans, reminders, images, and more)
- Long-term sticky-note memory (Settings → Memory), related-session citations, and tight-match context on nudge reminder emails
- Optional Resend send/receive. Add other services in `agent/connections/` if you need them.
- Custom instructions, sticky-note memory, and user-authored skills in Settings
- A Usage page with running session, turn, token, and cost totals — including by day
- Installable as a home-screen app on iPhone and Android (PWA). Push notifications are not enabled yet.

One deployment is one person's agent: a single owner account, named by
`OWNER_EMAIL`. Files are **Private** (only you and your sessions) or
**Public** (an unguessable `/d/...` link anyone on the internet can open).
This is not a multi-user or multi-tenant app.

On iPhone, open the site in Safari, tap Share, then **Add to Home Screen**. On Android Chrome, use **Install app** from the browser menu. Production must be HTTPS. The first production visit registers a service worker that caches static assets only — chat, auth, and API traffic stay on the network.

For the eve TUI only: `npm run dev:eve`.

## Configure the product (`app.config.ts`)

`app.config.ts` holds the defaults every deployment starts from. Values below are the current defaults. Change them one of two ways:

- **Per deployment, with environment variables** (recommended). Leave `app.config.ts` alone and set overrides on the Vercel project. Your fork then pulls upstream without merge conflicts, and one repo can run several differently branded deployments (for example the public demo and your own site). See [Per-deployment overrides](#per-deployment-overrides).
- **In the file.** Edit `app.config.ts`, then restart `npm run dev` or redeploy. Use this when the change should apply to every deployment of your fork.

### Per-deployment overrides

| Variable | Overrides | Example |
| --- | --- | --- |
| `NEXT_PUBLIC_APP_NAME` | `brand.name` | `Friday` |
| `NEXT_PUBLIC_APP_TAGLINE` | `brand.tagline` | `My research desk.` |
| `NEXT_PUBLIC_BRAND_COLOR` | `theme.brandColor` | `#2f629f` |
| `NEXT_PUBLIC_APP_CONFIG` | Any key in `app.config.ts`, as JSON | see below |

`NEXT_PUBLIC_APP_CONFIG` is a JSON object with only the keys you want to change. It is deep-merged over `app.config.ts`, so everything you leave out keeps its default:

```bash
NEXT_PUBLIC_APP_CONFIG='{
  "home": { "promptPlaceholder": "What are we working on?" },
  "theme": { "radius": "0.375rem", "dark": { "primary": "#9ab8de" } },
  "skills": { "story": { "enabled": false }, "household": { "suggest": false } },
  "models": { "chatLow": "openai/gpt-6.1-sol" }
}'
```

- The three shortcut variables win over the same keys in the JSON.
- In `.env.local`, quote any value that contains `#` (`NEXT_PUBLIC_BRAND_COLOR="#2f629f"`, JSON in single quotes as above). Unquoted, `#` starts a comment and the value is cut off. Values typed into the Vercel dashboard need no quotes.
- A key that `app.config.ts` does not define, a wrong type (`"enabled": "no"`), invalid JSON, or a CSS value that is not a plain color or length **fails the build** with a list of what to fix, so a typo never ships half-applied. The previous deployment keeps serving.
- Values are inlined at build time: **redeploy** after changing them (Vercel → Deployments → Redeploy). Locally, restart `npm run dev`.
- Everything here reaches the browser. It is for product defaults only — never secrets, emails, domains, or access lists. Those stay in their own variables.
- Adding a new built-in skill still needs its folder under `agent/skills/` and an entry in `app.config.ts`; the override can only turn existing skills on or off.

### Theme

```ts
theme: {
  brandColor: null,          // one color for primary buttons and focus rings, light and dark
  brandForeground: "#ffffff", // text on brandColor; keep 4.5:1 contrast
  radius: null,              // e.g. "0.5rem"; null keeps 0.625rem
  light: {},                 // per-token overrides, e.g. { background: "#fbfaf7" }
  dark: {},                  // same tokens, dark mode
  browserColor: { light: "#f7f7f7", dark: "#171717" }, // browser toolbar / installed-app title bar
  icon: { background: "#000000", foreground: "#ffffff" }, // home-screen icon and favicon
},
```

Token names are the CSS variables in `app/globals.css` without the leading `--`: `background`, `foreground`, `card`, `primary`, `primary-foreground`, `secondary`, `muted`, `muted-foreground`, `accent`, `border`, `input`, `ring`, and the rest of that list. Values are any CSS color (`#2f629f`, `oklch(0.55 0.15 250)`, `rgb(47 98 159)`). With the default theme no extra CSS is rendered. To change fonts or anything structural, edit `app/layout.tsx` and `app/globals.css`.

### Brand and home page

```ts
brand: {
  name: "Jarvis",
  tagline: "An opinionated but flexible workspace for quickly building AI agents.",
},
home: {
  promptPlaceholder: "Ask anything...",
  followUpPlaceholder: "Ask a follow-up…",
},
```

`name` is the header, auth screens, shared-file footer, and browser title. `tagline` is the home page description and the HTML meta description.

### Built-in skills

Each key matches a folder under `agent/skills/<slug>/`.

| Field | Meaning |
| --- | --- |
| `enabled` | `false` hides the skill from the home page and Settings, and tells the agent not to load it |
| `suggest` | `true` shows a suggestion chip on the home page |
| `title` / `emoji` | Chip label; clicking inserts `/slug` into the prompt |

Current defaults — a general starter kit (work, home, and a couple of creative examples). All enabled; intake, files, and memory are on but not suggested on the home page:

- `brainstorming`, `write`, `research`, `meeting-prep`, `plan`
- `image`, `household`, `story`, `decide`, `weekly-review`, `remind`
- `intake`, `files`, `memory`

These are examples of procedures you can ship with Jarvis, not a vertical product. Hide or replace any of them via `skills.<slug>.suggest` / `.enabled`, or add your own folder under `agent/skills/`.

`/remind` (aliases `/reminder`, `/reminders`) creates a one-off job. A nudge omits `skill` and emails you. A do-job passes `skill: remind`, checks prior work, then emails. Both delete the job after it fires. Nudge emails may attach one prior session and one file when those embeddings clear the reminder floors below.

To turn one off:

```ts
research: {
  enabled: false,
  suggest: false,
  // ...
},
```

To add a default skill, create `agent/skills/<slug>/SKILL.md` and add a matching entry here. To remove a skill from the agent entirely, delete its folder under `agent/skills/` as well.

Do not copy coding-agent or library skills (`ai-elements`, `streamdown`, `ai-sdk`, `agent-browser`, `web-design-guidelines`) into `agent/skills/`. Eve advertises every skill on every turn; those packages are large and are not end-user workflows.

Users can still create their own skills in Settings; those are per-account and are not listed in this file.

### Models

Chat IDs are AI Gateway strings (`provider/model`). On the first prompt of a session, `chatFast` classifies how much thinking is needed and picks one chat route for the whole session (so later turns can reuse the prompt cache): `fast` uses `chatFast`, `reason` uses `chatLow`, and `complex` uses `chatHigh`, each at its effort in `models.reasoning`.

| Key | Used for | Default |
| --- | --- | --- |
| `chatFast` | Quick answers, first-prompt routing, inbound email triage, and `web_search` | `openai/gpt-6-luna` |
| `quickReply` | Instant first reply before the agent starts (see below) | `openai/gpt-6-luna` |
| `chatLow` | First prompts that need analysis or thinking | `openai/gpt-6-luna` |
| `chatHigh` | First prompts that look unusually complex | `openai/gpt-6.1-sol` |
| `instructions` | Generating instruction overlays and custom skills | `openai/gpt-6-luna` |
| `sessionTitle` | Recents list titles and descriptions | `openai/gpt-6-luna` |
| `sessionMemory` | Related-session recall | `openai/gpt-6-luna` |
| `compaction` | Context-window checkpoints | `openai/gpt-6-luna` |
| `embeddings` | Session, file, and inbox email embeddings | `openai/text-embedding-3-small` |
| `imageGeneration` | `generate_image` | `openai/gpt-image-2` |
| `transcription` | Voice input (AI Gateway, same credentials as chat) | `spacexai/grok-stt` |
| `speech` | Spoken replies in voice mode (AI Gateway text-to-speech) | `spacexai/grok-tts` |

Any AI Gateway model ID works, including other providers (`anthropic/…`, `google/…`).

`models.reasoning` sets the reasoning effort per feature (`provider-default`, `none`, `minimal`, `low`, `medium`, `high`, or `xhigh`):

| Key | Feature | Default |
| --- | --- | --- |
| `chatFast` | `fast` chat route | `medium` |
| `chatLow` | `reason` chat route | `high` |
| `chatHigh` | `complex` chat route | `medium` |
| `routing` | First-prompt route classification | `low` |
| `quickReply` | Instant first reply. Keep it `none` or `minimal`; reasoning delays the first token | `none` |
| `emailClassification` | Inbound email action items | `medium` |
| `webSearch` | `web_search` query call | `medium` |
| `sessionTitle` | Recents list titles and descriptions | `low` |
| `sessionMemory` | HyDE draft for related-session recall | `low` |
| `instructions` | Instruction overlays, custom skills, and schedules | `high` |

Compaction has no entry: eve has no compaction reasoning setting when the chat model is chosen dynamically, so checkpoints run at the provider's default effort. Chat routes pass the effort through each provider's own option where `agent/lib/models.ts` knows it (OpenAI, Anthropic, xAI); other providers run with their defaults. Calls that reason get extra `maxOutputTokens` headroom (`lib/reasoning.ts`) so thinking does not crowd out the answer. Routing and HyDE block the first token of a turn, so more effort there means a slower start.

If you change a chat model ID, add its context window under `models.contextWindows` (tokens). Unknown IDs fall back to `1_050_000`. Compaction and the session context chip use `min(256_000, 90% of that catalog size)` so a million-token model does not fill its full window.

### Instant first reply

```ts
quickReply: {
  enabled: true,
  decisionTimeoutMs: 5_000,
  maxAnswerTokens: 1_200,
},
```

Starting an agent session (routing call, related-session recall, the sandbox, a reasoning model) takes a few seconds before the first token. So the first prompt of a new chat goes to `POST /api/quick` first: one streaming call to `models.quickReply` with no tools that starts with a decision line.

- **Answer** — greetings, the date or time (the browser sends its time zone), simple facts, arithmetic, short rewrites. The reply streams straight into the chat and is saved to the chat log like any turn; no agent session starts. A follow-up in that chat goes through the same layer, with the earlier quick turns as history.
- **Hand off** — anything that needs tools, files, email, memory, live data, or real work. The chat shows a one-line acknowledgment ("Checking your inbox for the Acme invoice…") while the agent starts. The layer also picks the agent's `fast` / `reason` / `complex` route and passes it as a short-lived signed hint (`x-jarvis-route-hint`, keyed from `BETTER_AUTH_SECRET`), so the agent skips its own routing call. The agent's first turn gets any earlier quick answers as client context.

Prompts with attachments or a `/skill` mention, and every prompt once an agent session exists, skip the layer. If it errors, or does not decide within `decisionTimeoutMs`, the prompt goes to the agent as if the layer were not there. Set `enabled: false` to turn it off. Its cost shows as **Instant replies** on the Usage page.

### Resend inbox

```ts
resendInbox: {
  enabled: true,
  triageInstructions: "This is a personal assistant's inbox. Label every new thread…",
  triageActions: ["add_labels", "draft_reply", "archive", "mark_as_spam"],
  triageTone: "concise_casual",
},
```

With [Resend Inboxes](https://resend.com/docs/dashboard/inboxes/introduction), you can host the agent address (`RESEND_FROM_EMAIL`, for example `agent@yourdomain.com`) as an inbox: click **Turn on Resend inbox** under **Settings → Inbox**, or create an inbox on that address in the Resend dashboard yourself. Resend then keeps the mail as threads with labels, folders, and drafts.

- **Triage** — on creation, the app configures Resend's built-in inbox agent with `triageInstructions`, `triageActions`, and `triageTone`. It labels new threads and saves reply drafts; it never sends. Empty instructions leave it off.
- **Agent tools** — `inbox_threads` (list or full-text search, filter by folder, label, unread), `inbox_thread` (read messages and pending drafts), `inbox_reply` (save a reply draft, or send a reply or an existing draft in the thread — sending always needs approval), and `inbox_organize` (archive, mark read, add or remove labels).
- **Inbound** — add `inbox.email.received` to the Resend webhook that already sends `email.received` to `/api/webhooks/resend`. While the inbox exists, agent mail is handled from that event (the plain `email.received` path skips it, so nothing is stored twice). New mail is stored for search and the Inbox page like any inbound email. The same rule decides whether it may start a session (see [Email to the agent](#email-to-the-agent)), and that session is told the thread id so it replies in the thread.
- **Outbound** — mail the agent sends to the account owner comes from the inbox address, so the owner's reply lands in the same inbox.

The inbox holds the owner's mail, and only the owner can sign in, so it shows in Settings and the `inbox_*` tools work for that one account. Resend includes a few free inboxes per account and bills beyond that, so nothing is created until you turn it on. It needs `RESEND_FROM_EMAIL` on a domain with receiving enabled. Set `enabled: false` to hide it; mail to the agent address keeps working through `email.received` either way.

### Voice mode

```ts
voice: {
  speechVoice: "ara",
  maxSpeechChars: 2_000,
},
```

The waveform button next to the mic turns on hands-free voice mode for that browser. It starts listening right away and shows a live waveform; when you stop talking (about 1.3 seconds of quiet) the recording is transcribed by `models.transcription` and sent. The composer shows **Thinking…** while the agent works, then the reply is read aloud by `models.speech` in `speechVoice` (Grok TTS voices: `ara`, `eve`, `leo`, `rex`, `sal`) with a waveform, and then it listens again. Markdown, code blocks, links, and citation markers are dropped first, and replies longer than `maxSpeechChars` are cut at a sentence boundary. Tap the mic to interrupt a reply, the check to send early, or **End voice** to leave voice mode. If nobody speaks for about 12 seconds it stops listening until you tap the mic. Voice mode keeps the full agent (tools, files, memory) in the loop; it is not a separate realtime speech-to-speech model.

### In-app setup page

```ts
setup: {
  inAppPage: true,
},
```

`true` shows **Settings → Setup**. `false` hides the page and its links without deleting files.

### Related-session memory and reminder context

```ts
memory: {
  relatedSessionLimit: 8,
  relatedSessionMinScore: 0.55,
  hydeTimeoutMs: 6000,
  reminderContextMinScore: 0.74,
  reminderContextBodyMinScore: 0.78,
  reminderContextSnippetChars: 200,
},
```

Prompts shorter than three words (greetings, "thanks") skip recall entirely, and the chat lookup runs alongside the embedding calls rather than before them. HyDE (a hypothetical reply used only for retrieval, at `models.reasoning.sessionMemory`) is aborted after `hydeTimeoutMs`. Keep that long enough for the chosen effort, or HyDE will almost always time out; with reasoning `none`, about `1000` is enough. Recall then searches with whatever query embeddings are ready — usually just the prompt — and continues the turn with no related sessions if nothing ranks above `relatedSessionMinScore`.

Nudge reminder emails do **not** use that related-session path. At fire time the app embeds the reminder brief only (no HyDE) and searches session titles/descriptions/prompts plus file titles/content. A hit must clear `reminderContextMinScore`. A body-only hit (prompt text or file content, no title match) must also clear `reminderContextBodyMinScore`. At most one session and one file are attached, each as a title, a short snippet (`reminderContextSnippetChars`), and a link. A thin brief (“remind me tomorrow”) skips retrieval. Nothing matched is the success case when the note is not clearly about this reminder.

On Neon, related-session search uses pgvector HNSW top-K (cosine) instead of loading every stored embedding into the app. Local JSON fallback still scores in process.

### Usage and cost

The session context chip shows the locked chat model, current context fill, compaction count, and a running session cost. Usage lives on **Usage** (not Settings): your sessions, turns, tokens, and cost, overall and by day, model, and activity.

Costs use the catalog in `lib/model-prices.ts` (OpenAI list rates, including cache and long-context tiers). Chat and compaction steps also use provider `costUsd` when the stream reports it. The ledger includes routing, titles, related-session memory, embeddings, instruction generation, transcription, image generation, inbound-email action classification, and Exa web search (`$7` / 1k searches via AI Gateway) — not only the visible chat turns.

Sessions are unique conversations. Turns are unique user/agent exchanges (a turn can make several model calls plus searches). Model calls exclude web search; search is a separate per-request fee.

Not in this ledger: Vercel hosting/functions, Neon compute and storage, Vercel Blob for files, and Resend delivery. Those are platform or vendor bills, not token-metered model calls.

### Keeping Neon cheap

Neon bills compute for every minute the database is awake, at the compute size it is running. The app is written so an idle workspace lets it sleep:

- **Schema bootstrap runs once per schema change**, not on every cold start. A fingerprint of `migrateNeonSchema` in `lib/db/index.ts` is stored in `app_schema_version`; a cold start reads that one row and skips the ~85 DDL statements when it matches. Edit the migration freely, and it reruns once on the next deploy.
- **Chat transcripts are checkpointed, not streamed token by token.** The browser saves the event log every few seconds while a turn streams, and once when it settles, writing only rows that changed. Runs of streaming deltas are collapsed first (`lib/chat-event-compaction.ts`), so a long reply is a handful of rows instead of thousands. Usage is tallied once per turn.
- **A failing schedule does not retry every tick.** A recurring job skips to its next slot and keeps the error on the Schedules page; a one-off retries every five minutes and pauses after six hours.

In the Neon console, set the production compute to **0.25 CU minimum** (autoscaling up to 1 CU is plenty for a personal workspace) and leave scale-to-zero on. A 1 CU minimum bills four times as much for every awake minute. Anything else holding the same `DATABASE_URL` (a local `npm run dev` or `eve start` pointed at production, a SQL client left open) keeps it awake too.

## Environment variables

Copy `.env.example` to `.env.local` (local) or set the same keys on the Vercel project (production). The [Quick start](#quick-start) and the in-app checklist walk through the ones you need first.

### Owner

`OWNER_EMAIL` is the one account that can sign up, sign in, and keep a session. Set it in `.env.local` locally, or on the Vercel project for production and preview. Until it is set, `/` shows **Set up your workspace** instead of chat, and a hosted deploy accepts no sign-ups.

```bash
OWNER_EMAIL=you@example.com
```

- It is matched case-insensitively.
- Changing it to another address locks the old account out at its next request. Its data stays in the database but is no longer reachable.
- Any other account in the database (for example from an older, multi-user version of Jarvis) can't sign in. Its rows stay untouched.

| Variable | Required | Purpose |
| --- | --- | --- |
| `BETTER_AUTH_SECRET` | Yes | Auth cookie signing. Use a 32+ character random string. |
| `BETTER_AUTH_URL` | Yes | Public origin. Local default is `http://localhost:3000`. Production must be **your** canonical origin (set on the Vercel project, not in source). Clones and forks do not inherit a production host. Preview deploys also allow `*.vercel.app`. |
| `OWNER_EMAIL` | Yes | The one account that can sign up and sign in. Setting it hides the setup checklist. |
| `RATE_LIMIT_DISABLED` | Local only | Set to `1` to skip the in-process limiter during soak tests. Ignored in production. |
| `VERCEL_TEAM_ID` | With `VERCEL_TOKEN` | Your Vercel team id (`team_…`, under Team Settings). The plan lookup reads the team's plan through `VERCEL_ORG_ID` or `VERCEL_TEAM_ID`; without either it reads your personal account's plan, which is Hobby even when the team is Pro. |
| `VERCEL_TOKEN` | Optional | Personal token so the app can read the Vercel team billing plan. Without it, the host is treated as Hobby: scheduled jobs at most once a day, and the dispatcher compiles to a daily cron. Pro or Enterprise unlocks hourly and minute-level jobs after a redeploy. |
| `EMAIL_SESSION_SECRET` | Optional | Shared secret for unattended schedule and inbound-email session starts. When unset, one is derived from `BETTER_AUTH_SECRET`, so most deploys can leave this out. |
| `AI_GATEWAY_API_KEY` | Local | AI Gateway. On Vercel, OIDC from the linked project can replace this. |
| `DATABASE_URL` | Production | Neon Postgres. Unset locally → SQLite + `.data/app.json` |
| `BLOB_READ_WRITE_TOKEN` | Production | Vercel Blob for private files and file memory. Local fallback is `.data/blobs/` |
| `RESEND_API_KEY` | Signup + Inbox | Verification emails on signup, plus agent send/receive. Get a key at [resend.com/api-keys](https://resend.com/api-keys). Required for production signup. Local `npm run dev` without it prints the verification URL in the server log. |
| `RESEND_WEBHOOK_SECRET` | For inbound | Signing secret from Resend → Webhooks (`email.received`, plus `inbox.email.received` for [Resend inboxes](#resend-inbox)) |
| `RESEND_FROM_EMAIL` | Signup + agent mail | The agent's one address, e.g. `Jarvis <agent@yourdomain.com>`. Signup verification and all agent mail are sent from it, inbound mail to it is received, and the optional [Resend inbox](#resend-inbox) lives on it. Use a domain with sending and receiving enabled in Resend. |
| `MSB_HOME` | Recommended | Keep `.eve/msb-home` so this project’s microsandbox state stays isolated |
| `NEXT_PUBLIC_APP_NAME` | Optional | Product name for this deployment (`brand.name`). See [Per-deployment overrides](#per-deployment-overrides). |
| `NEXT_PUBLIC_APP_TAGLINE` | Optional | Home page and meta description (`brand.tagline`) |
| `NEXT_PUBLIC_BRAND_COLOR` | Optional | Primary button and focus color (`theme.brandColor`) |
| `NEXT_PUBLIC_APP_CONFIG` | Optional | JSON deep-merged over `app.config.ts`. Public; no secrets. Invalid keys fail the build. |

## Deploy to Vercel

The [Deploy on Vercel](#deploy-on-vercel-recommended) button in Quick start is the usual path: it prompts for env vars and offers Neon plus private Blob. Importing a fork yourself is under [Import the repo yourself](#import-the-repo-yourself). From a terminal after `npm install`:

```bash
npx eve deploy --non-interactive --yes --project your-project-name
```

Or link first, then deploy:

```bash
npx eve link --non-interactive --project your-project-name
npx eve deploy --non-interactive --yes
```

Set `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` (your production URL — each clone or fork must set its own), `DATABASE_URL`, and `RESEND_API_KEY` on the project before the first production signup. Verification emails will not send without Resend. `npm run dev` does not fire eve schedules on their cron; use **Settings → Schedules → Run now**. A production deploy turns `agent/schedules/dispatcher.ts` into a Vercel Cron Job — confirm it under **Settings → Cron Jobs**. The host is treated as Hobby unless you set `VERCEL_TOKEN` and the billing API reports Pro or Enterprise: then a redeploy compiles a per-minute dispatcher and Settings / the agent allow hourly jobs. Hobby stays daily. `BETTER_AUTH_URL` must be the public origin so the dispatcher can start sessions. If Deployment Protection is on, enable the project’s automation bypass secret so that self-call can get through. Production auth trusts that origin plus localhost; it does not allow every `*.vercel.app` host. Preview deployments still accept the Vercel wildcard. Add Blob (`BLOB_READ_WRITE_TOKEN`) so files and sticky-note memory persist across deploys. Set `OWNER_EMAIL` on the project (not in `app.config.ts`) so the setup checklist leaves the home page and only you can sign up and sign in.

Signup verification uses the same `RESEND_API_KEY` and `RESEND_FROM_EMAIL`.

#### Email to the agent

`RESEND_FROM_EMAIL` is the agent's one address (for example `agent@yourdomain.com`). Mail the agent sends to you comes from it; mail to anyone else goes out from it as "Name via Jarvis" with `Reply-To` set to you. Enable receiving on that Resend domain and point a webhook at `https://your-app.vercel.app/api/webhooks/resend` for `email.received` (plus `inbox.email.received` if you use a [Resend inbox](#resend-inbox)). Store the signing secret as `RESEND_WEBHOOK_SECRET`. Mail to other addresses on the same Resend account is ignored. The `email.received` webhook is metadata only; the app then calls Resend `emails.receiving.get` (and raw MIME if needed) so each message is stored as HTML and plain text and embedded for inbox search. Mail is filed for the account whose email sent it, or else for the workspace owner (the first account). This is one person's agent, so anyone who knows the address can write to it; that mail is only filed. An unattended session starts only when all of these hold: From is an account's own email, the receiving server reports a DMARC pass for that domain (`security.emailSessionsRequireDmarc` in `app.config.ts`), and the message looks like an action. The DMARC verdict is read from the raw message (Resend's `raw` download), and only the topmost `Authentication-Results` header counts, since a sender can add a forged one below it. Without a raw message, no session starts. Email to your own account address only (no other recipient, no CC) sends without an approval prompt from any session, so a research brief, schedule, or emailed request can mail you its result unattended; set `security.selfEmailRequiresApproval` in `app.config.ts` to `true` to approve those too. Mail to anyone else always waits for your approval. Scheduled one-off reminders send to the signed-in user's account email from their agent address and include a link to the reminder session. A nudge may attach at most one prior session and one file, and only when those embeddings clear the reminder floors in `app.config.ts` (`memory.reminderContextMinScore` / `reminderContextBodyMinScore`).

Pushing to a Git-connected Vercel project also deploys. Changing `app.config.ts` requires a new deploy — it is compiled into the app, not read at request time from the host disk.

HTML responses send a Content-Security-Policy plus `X-Content-Type-Options`, `Referrer-Policy`, and `X-Frame-Options` from `next.config.ts`. This repo does not set HSTS so localhost stays usable; on a custom HTTPS domain, add `Strict-Transport-Security` at the host (Vercel / your CDN), not for `next dev`.

### Agent safety defaults

- `send_email` asks for approval in the session before it sends, except on an unattended reminder to the account owner with no `cc`. Approve or deny in the chat.
- `inbox_reply` saves drafts freely but asks for approval before it sends a reply or a draft from the Resend inbox. Resend's own inbox agent only labels, archives, and drafts; it never sends.
- The agent's sandbox (`bash`) has no outbound network by default (`security.sandboxNetwork` in `app.config.ts`). Web access goes through `web_search` and `web_fetch`, which run in the app.
- Files are served inline only for images, PDF, plain text, Markdown, CSV, and JSON, under a sandboxing CSP. Everything else downloads.
- An eve session can only be continued or streamed by the account whose chat recorded it (a second guard behind the single-owner rule).

## Customize the agent beyond the config file

| What you want | Where to edit |
| --- | --- |
| The owner account (also hides the setup screen) | `.env.local` / Vercel env (`OWNER_EMAIL`) |
| Hourly or minute-level scheduled jobs | Vercel env `VERCEL_TOKEN` (a token scoped to your Pro or Enterprise team) and `VERCEL_TEAM_ID`, then redeploy. Without them, jobs stay at most once a day. |
| Hide the signed-in setup page | `app.config.ts` (`setup.inAppPage`) |
| Identity, tone, and default workflows | `agent/instructions.md` |
| Your overlay (working style) | Settings → Instructions, or the Settings prompt |
| The agent's send/receive address | `RESEND_FROM_EMAIL` (shown in Settings → Inbox) |
| Built-in skill steps | `agent/skills/<slug>/SKILL.md` |
| Tools, connections, schedules | `agent/tools/`, `agent/connections/`, `agent/schedules/` |
| Intake briefs, quotes, plans, decisions | Files (`create_document`) or sticky-note memory — not dedicated Neon tables |
| Custom domain tables (your fork) | `lib/db/schema.ts`, shared rules in `lib/store-logic.ts`, helpers in `lib/store-pg.ts` / `lib/store-json.ts`, and a tool under `agent/tools/` |
| Industry-specific behavior | Custom skills + the instruction overlay — not a second hardcoded identity |

After a content-only instructions or skill change, restart `npm run dev` (or redeploy) so eve reloads the agent.

## Project layout

```
app.config.ts          # Brand, home copy, quick reply, Resend inbox, skills, models, in-app setup flag
app/                   # Next.js App Router (chat, files, inbox, settings, auth)
agent/                 # eve agent: instructions, tools, skills, connections
lib/                   # Shared store, files, auth, helpers
components/            # UI
docs/screenshots/      # README previews
.env.example           # Environment variable template
LICENSE                # MIT
```

Local data (when `DATABASE_URL` is unset) lives under `.data/` and is gitignored.

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Next.js + eve |
| `npm run dev:eve` | eve TUI |
| `npm run build` | Next.js production build |
| `npm run deploy` | `eve deploy` |
| `npm run typecheck` | `tsc --noEmit`. Includes `agent/tools`, `lib`, and `agent/skills/user.ts`. Skill procedure folders are markdown (`SKILL.md`), not part of the TS program. |
| `npm run lint` | ESLint (Next.js config) |
| `npm test` | Vitest unit tests |
| `npm run eval` | `eve eval`. Workspace cases in `evals/` (answer-first, no invented prices, memory vs file). Needs `AI_GATEWAY_API_KEY` (same as `npm run dev`). Skill evals under `agent/skills/*/evals` remain for those skills. |
