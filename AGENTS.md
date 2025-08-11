# Repository Guidelines

## Project Structure & Module Organization
- Source: `src/` — `index.ts` (Worker entry), `rss.ts` (RSS fetch/parse), `discord.ts` (Webhook + retry), `mock.ts` (test helper).
- Tests: `test/*.test.ts` (Vitest). Keep unit tests close to behavior (parsing, retries, KV logic via fakes).
- Config: `wrangler.jsonc` (cron, KV, env vars), `tsconfig.json`, `biome.json`, `.editorconfig`, `.dev.vars` (local dev values; never commit secrets).

## Build, Test, and Development Commands
- `npm install`: install dependencies.
- `npm run dev`: start Wrangler dev with scheduled testing enabled. Example: `curl "http://localhost:8787/__scheduled?cron=*+*+*+*+*"` to trigger.
- `npm test`: run Vitest once in CI-friendly mode.
- `npm run deploy`: deploy the Worker via Wrangler.
- `npm run cf-typegen`: regenerate `Env` bindings types from `wrangler.jsonc`.

## Coding Style & Naming Conventions
- TypeScript strict; spaces + LF per `.editorconfig`. Prefer small, pure functions.
- Biome for format/lint: double quotes, organize imports, recommended rules.
  - Check: `npx biome check .`
  - Format: `npx biome format --write .`
- Naming: files lowercase (e.g., `rss.ts`, `discord.ts`); functions/vars `camelCase`; types/interfaces `PascalCase`.
- Logs: use `console.log`/`console.error` for observability; keep messages actionable.

## Testing Guidelines
- Framework: Vitest. Place tests under `test/` and suffix with `.test.ts`.
- Network: mock `fetch`; don’t hit real endpoints. Use `vi.useFakeTimers()` for retry/timer logic.
- Scope: cover RSS parsing/normalization, SHA-256 link hashing, 429 retry behavior, and 404 aborts.
- Run locally/CI: `npm test`.

## Commit & Pull Request Guidelines
- Commits: use Conventional prefixes (`feat:`, `fix:`, `chore:`, `docs:`, `test:`, `refactor:`). Keep messages imperative and focused.
- PRs: include purpose, summary of changes, linked issues, and relevant logs/output. Ensure tests pass and Biome checks are clean before requesting review.

## Security & Configuration Tips
- Secrets: use `wrangler secret put <NAME>` (e.g., `DISCORD_WEBHOOK_URL_IT`); never commit secrets. Toggle HTTP via `ENABLE_HTTP_REQUEST`.
- KV: ensure `RSS_FEED_WORKER_KV` exists/bound as in `wrangler.jsonc`.
