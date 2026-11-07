# eve Agent App

This project uses the eve framework: an agent is a directory of files under `agent/`, and eve compiles and runs it.

## Product defaults

Brand, home page copy, built-in skill enablement, and model IDs live in `app.config.ts`. Edit that file for name, tagline, composer placeholders, which default skills are on or suggested, chat/image/embedding/transcription/speech models, voice-mode speech voice (`voice.*`), related-session memory thresholds, reminder-email context floors, and whether the signed-in setup page is shown (`setup.inAppPage`). Do not re-hardcode those values in `lib/brand.ts`, `lib/app-config.ts`, or feature modules — they already read the config. Secrets, host URLs, and access allowlists (`ALLOWED_SIGNUP_EMAILS`, `ALLOWED_SIGNUP_DOMAINS`, `BLOCKED_ACCESS_EMAILS`, `ALLOWED_ACCOUNT_USAGE_EMAILS`) stay in `.env.local` / Vercel env. Optional `VERCEL_TOKEN` reads the Vercel billing plan so Pro unlocks sub-daily schedules; without it, assume Hobby. Never put emails or domains in `app.config.ts`.

A deployment can override any `app.config.ts` key without a code change through `NEXT_PUBLIC_APP_CONFIG` (JSON, deep-merged) and the `NEXT_PUBLIC_APP_NAME` / `NEXT_PUBLIC_APP_TAGLINE` / `NEXT_PUBLIC_BRAND_COLOR` shortcuts (`lib/config-overrides.ts`). When you add a config key, it is overridable automatically; if it is an open-ended map or a fixed list of values, register it in `OPEN_MAPS` / `enumFor` / `ENUM_LISTS` there and add a test. Colors and lengths for the UI go in `theme` (rendered by `lib/theme-css.ts`), not hardcoded in components.

- **Identity, purpose, tone** — `agent/instructions.md` (or files under `agent/instructions/`). You do not need the framework docs for a content-only instructions change.
- **Skill procedure** — `agent/skills/<slug>/SKILL.md`. Toggle `enabled` / `suggest` and the home-page chip in `app.config.ts`. Add a matching config entry when you add a built-in skill folder. Built-in skills should stay semi-generic (work, home, or a light creative example), not a hyper-specific vertical. Do not copy coding-agent or library skills (ai-elements, streamdown, ai-sdk, agent-browser, web-design-guidelines) into `agent/skills/` — eve advertises every skill every turn.
- **Session-generated records** — persist intake briefs, plans, comparisons, and similar as files (`create_document`) or sticky-note memory (durable preferences only). Do not add rigid Neon tables for CRM-shaped data in this repo. A fork may add a table in `lib/db/schema.ts`, shared rules in `lib/store-logic.ts`, store helpers in `lib/store-pg.ts` / `lib/store-json.ts`, and a tool under `agent/tools/`.
- **Which model ID a feature uses** — `app.config.ts` (`models.*`). Preserve `agent/agent.ts` unless the user asks to change how the low/high model is chosen at session or turn time.
- **Human install and deploy docs** — `README.md`. Keep it in sync when you add a config key or env var.

## Read the docs before writing code

```sh
ls node_modules/eve/docs
```

Start with `docs/README.md`: it maps each task to the page that covers it. Read that page before authoring tools, connections, channels, skills, subagents, schedules, or deployment. In a workspace or local package install, resolve the installed `eve` package location first. If the package docs are missing, use https://eve.dev/docs.

Use a bounded authoring loop:

1. Read the relevant page and inspect only files you will modify or need to imitate.
2. Stop discovery once the file location, imports, and definition shape are clear. Implement the smallest complete behavior the user requested.
3. Run one narrow verification. Expand investigation only when it fails or the request needs project-specific details.

Follow links or inspect public types only when the routed page leaves the task unanswered. Do not recursively glob `node_modules`, enumerate the entire docs tree, or read unrelated scaffold files when the direct path is known. Package-manager links can hide files from recursive glob tools even though direct reads work.

## Prefer an existing integration

When a task names an external product or service, search the registry before implementing its integration. For a generic capability, author a tool instead.

```sh
eve registry search <query> --json
eve registry view <item>
```

Prefer items whose `implementation` is `native`; use Chat SDK adapters when no native channel fits. `registry view` links the item's documentation.

Install without driving interactive prompts:

```sh
eve add <item> --non-interactive
```

Exit code 0 means setup completed, 1 failed, and 2 needs an answer or a prerequisite. On exit 2, run the `next.command` from the final NDJSON event. For a non-secret question, replace its `<JSON value>` answer placeholder with the answer you collected; string values need JSON quotes. Never pass a secret in `--answer`. See `docs/install-integrations.mdx` for setup prerequisites.

## Use eve for Vercel operations

Use eve to link and deploy Vercel projects:

```sh
eve link --non-interactive --project <name-or-id> [--team <team-id-or-slug>]
eve deploy --non-interactive --yes [--project <name-or-id>]
```

A setup may report `eve link` as a prerequisite; run it, then retry the continuation. When a completed setup event has `deploymentRequired: true`, run the `next` command it reports.

## Validate the change

Run the validation the task requests. When it does not establish the behavior you changed, run the narrowest relevant check.

`npm run typecheck` covers `agent/tools`, `lib`, and `agent/skills/user.ts`. Skill procedure folders (`SKILL.md`) are markdown, not TypeScript.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
