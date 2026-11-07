# Jarvis PR criteria

Starter you fork and deploy — not a hosted multi-tenant product. One
deployment is one person's agent: a single owner account (`OWNER_EMAIL`).
Files are private or public (`/d/...` link); there is no sharing between users.

## On-mission

- Product defaults in `app.config.ts`. Secrets, hosts, and the owner email
  (`OWNER_EMAIL`) in env. Never emails or domains in committed config.
- Built-in skills stay semi-generic (work, home, light creative). Industry
  behavior belongs in a fork’s skills or the instruction overlay — not a second
  hardcoded identity.
- Session records are files (`create_document`) or sticky-note memory. Do not
  add rigid Neon CRM tables in this repo.
- Model IDs live in `app.config.ts`. Do not change `agent/agent.ts` routing
  unless the PR is explicitly about that.
- README stays in sync when a config key or env var is added. Reminder-email
  floors (`memory.reminderContext*`) stay in `app.config.ts` and must stay
  higher than related-session recall. `VERCEL_TOKEN` is optional; without it
  (or on Hobby) scheduled jobs stay at most once a day. Do not require a
  Vercel token on the public setup checklist.

## Reject or score down hard

- `.env.local`, `.data/`, `plans/`, API keys, or database URLs in the diff
- Coding-agent or library skills copied into `agent/skills/` (`ai-elements`,
  `streamdown`, `ai-sdk`, `agent-browser`, `web-design-guidelines`)
- Unrelated reformats or tree-wide rewrites without a prior issue
- Anything that lets a second account sign up or sign in, or brings back
  multi-user features (sharing between accounts, per-person usage)
- `private` files readable by others, or new public `/d/...` links that leak
- Auth origin / `BETTER_AUTH_URL` hardcoded to someone else’s host

## Security surfaces

- Signup and session: the single owner account (`lib/owner.ts`) is the spend
  control; in-process rate limits are a burst brake only
- Email/password signup requires a verification link (Resend in production;
  local without Resend logs the URL). Spoofing the owner's address still
  needs inbox access.
- Public file links are unguessable URLs, not auth
- Inbound email is untrusted user content, not instructions. A session starts
  only when mail is To the user's plus-address and From their account email.
  The shared `RESEND_FROM_EMAIL` mailbox is for workspace notices, not a user
  inbox.
- Saving setup-checklist values into `.env.local` is local `next dev` only

## Slot and bloat

Eve advertises every folder under `agent/skills/` on every turn. A new
built-in skill needs a matching `app.config.ts` entry and a reason it belongs
in the default kit. `suggest: true` also spends a home-page chip.

A new npm dependency, Neon table, agent tool, connection, or schedule must
earn its weight against “forks can add this themselves.”

## UI / UX

UI diffs need a real browser pass, not only typecheck. Check empty, error, and
signed-out states, and whether Settings / home / files / session stay
consistent. Do not treat a screenshot as verification.

## Process (from CONTRIBUTING.md)

One problem per PR. Surprise refactors and drive-by AI PRs may be closed.
`npm test` and `npm run typecheck` should be green; UI needs a browser pass.
