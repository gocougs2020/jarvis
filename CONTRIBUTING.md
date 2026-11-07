# Contributing

Thanks for wanting to help. Jarvis is a personal starter — chat, files, memory, skills, scheduled jobs, and inbox — not a hosted product. Be decent; see the [code of conduct](./CODE_OF_CONDUCT.md).

## Before you write code

1. Open an issue and describe the change. Do not send a surprise refactor.
2. Keep the diff to the bug or feature you named.
3. Product defaults stay in `app.config.ts`. Secrets stay in env vars. Anything a deployment should be able to change (copy, colors, toggles) belongs in `app.config.ts` so `NEXT_PUBLIC_APP_CONFIG` can override it — do not hardcode it in a component.

## How to work

```bash
npm install
cp .env.example .env.local
# set BETTER_AUTH_SECRET, BETTER_AUTH_URL, and AI_GATEWAY_API_KEY
npm run dev
```

Then:

```bash
npm test
npm run typecheck
npm run lint
```

UI changes need a real pass in the browser, not only a compile.

## Please do not

- Commit `.env.local`, `.data/`, or `plans/`
- Copy coding-agent skills (`ai-elements`, `streamdown`, `ai-sdk`, `agent-browser`) into `agent/skills/`
- Reformat unrelated files
- Add a second hardcoded identity — industry behavior belongs in skills and the instruction overlay

## Pull requests

One problem per PR. Say what you changed and how you checked it. Maintainers may close drive-by AI PRs that rewrite large parts of the tree.
