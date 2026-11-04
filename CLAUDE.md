# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository shape

Two independent npm packages, no root `package.json`:

- `server/` — Fastify 5 + Prisma 6 + PostgreSQL 16 + Redis 7 (ESM, `tsx` for dev)
- `frontend/` — React 19 + Vite 6 + Tailwind 4 + TanStack Query 5 + ECharts (ESM)

Both packages share the same version number; bump them together (see Versioning).

## Commands

All commands run from inside `server/` or `frontend/`.

### Server

```bash
cd server
npm run dev                 # tsx watch, reads .env, http://localhost:4000
npm test                    # vitest, needs postgres + redis
npm test -- tests/integration/admin.test.ts        # single file
npm test -- -t "超管可以"                           # single test by name
npm run test:db:setup       # create comporalife_test + run migrations (once)
npm run typecheck
npm run lint
npm run build               # tsc -p tsconfig.build.json -> dist/
npm start                   # node --env-file=.env dist/index.js

npx prisma migrate dev      # dev migrations
npx prisma migrate deploy   # deploy migrations
npm run seed                # super admin + category templates
npm run seed:demo           # demo account + fake data (never in production)
```

Tests use a **separate database** `comporalife_test` (set in `server/vitest.config.ts`), never the dev DB. Test helpers live in `server/tests/helpers.ts`; they create users per-suite via `testDomain()` so parallel suites don't delete each other's data.

### Frontend

```bash
cd frontend
npm run dev                 # vite, http://localhost:5173, proxies /api -> :4000
npm run build               # tsc --noEmit && vite build
npm run typecheck
npm run lint
npm test                    # vitest (jsdom)
npm test -- src/lib/format.test.ts
```

### Repo-root scripts (`scripts/`)

Auto-verification scripts run against **live** dev servers (frontend on 5173, API on 4000), driving headless Chrome via CDP:

- `node scripts/verify-admin-users-page.cjs` — admin users page flow (creates then deletes its test users)
- `node scripts/check-i18n-keys.cjs` — verifies every `t('ns:key')` referenced in source exists in `zh-CN` locales
- `node scripts/check-currency-parity.cjs` — verifies frontend/backend currency metadata match
- `scripts/verify-*.cjs` — one per feature area; they use `--headless=new` Chrome directly (not Playwright)

## Architecture

### API contract

Every response is an envelope: `{ success, data, meta: { requestId } }` on success, `{ success: false, error: { code, message, details?, params? }, meta }` on failure. Helpers in `server/src/lib/api-utils.ts` (`ok`, `parsePageParams`, `buildPagination`). List endpoints put pagination in `meta.pagination`.

Errors are typed codes in `server/src/lib/errors.ts` (`ErrorCode` + `ERROR_STATUS` + `errors.*` factories throwing `AppError`). The error-plugin (`plugins/error-handler.ts`) serializes `AppError`, `ZodError` (→ `VALIDATION_ERROR` 400), rate-limit 429, multipart 413, and generic Fastify client errors. The frontend translates by code via `frontend/src/lib/error-message.ts` → `errors:<CODE>` i18n entries, falling back to the server `message`.

### Server module layout

Each feature lives in `server/src/modules/<feature>/` split into `.routes.ts` (thin handlers: parse params → call service → `ok(...)`), `.schema.ts` (zod), and `.service.ts` (data/logic). Routes are registered centrally in `server/src/app.ts` under the `/api` prefix; **route registration order matters** where a param route could swallow a literal one (e.g. templates before `/imports/:id`).

Cross-cutting pieces:
- `plugins/auth.ts` decorates `app.authenticate` (preHandler) and `requireAuth(request)` → `{ userId, role, sessionId }`. It re-reads the user from DB every request and rejects if `status !== 'active'` or `sessionVersion` mismatches the JWT claim.
- `plugins/prisma.ts` / `plugins/redis.ts` decorate `app.prisma` / `app.redis`; `buildApp({ withPrisma, withRedis })` lets tests disable them.
- Async work: `JobExecutor` (`app.jobs`, Monte Carlo) and `TaskExecutor` (`app.tasks`, exports/backups/restore) run in-process, shard their work, and are started only after `listen()` in `index.ts`. Job state lives in the DB, never in memory.
- Scheduled work: `scheduleImportCleanup`, `scheduleDataRetention`, `scheduleRateSync` — registered in `index.ts`, not in `buildApp`, so tests don't spawn timers.

### Domain invariants (enforced in services, not optional)

These are correctness requirements, not style:

- **Double-entry ledger.** Every transaction's entries sum to zero or the whole write rolls back (`LEDGER_UNBALANCED`). Income/expense pair with an external counterparty; transfers are two real-account entries.
- **Balances are derived**, never stored: balance = opening balance + posted entries (`accounts/balance.service.ts`).
- **Deletion is reversal** (`voided`), not physical deletion.
- **Investment is not income/expense.** Buy/sell are `investment`-type asset conversions; only dividends/interest (income) and fees/taxes (expense) hit cash-flow stats.
- **Money is Decimal end-to-end.** DB `DECIMAL(20,6)`, `decimal.js` in `server/src/lib/money.ts`, API transmits **strings**. Never use JS floats for money. Precision: `MONEY_SCALE=6`, `RATE_SCALE=10`, `PRICE_SCALE=8`.
- **Missing exchange rates are never guessed** — affected accounts are excluded and reported (`CURRENCY_RATE_MISSING`), never treated as 1:1.
- **Metrics carry their口径** (range, base currency, timezone, completeness flags).
- **Uncomputable metrics return `null` + reason**, never `0` (e.g. TWR/XIRR).
- **Monte Carlo determinism**: same seed + params + `modelVersion` ⇒ bit-identical results.

### Auth & sessions

Access token is JWT, held **in memory only** on the client (`frontend/src/lib/client.ts` `accessTokenGetter`), sent as `Bearer`. Refresh token lives in an httpOnly `cl_refresh` cookie; on 401 the client auto-refreshes once (deduped across concurrent requests, retried once for cross-tab rotation). `sessionVersion` on the user invalidates old JWTs — bump it on role change, password change, disable, or revoke. Roles: `user` < `admin` < `super_admin`; `requireAdmin` / `requireSuperAdmin` guards in `admin.routes.ts`. Frontend `AdminGuard` is UI-only; the server is authoritative.

### Admin isolation (hard rule)

Admin code lives in `server/src/modules/admin/` and must **never return user financial data** — only account metadata, aggregate counts, and read-only process stats. Emails/IPs are masked in audit contexts (`maskEmail`, `maskIp` in `admin.service.ts`). `assertRoleChangeAllowed` blocks self-modification and demoting/disabling the last active super admin.

### Frontend structure

- `pages/<Feature>Page.tsx` are route components, all `lazy()`-loaded in `src/App.tsx`; admin routes nest under `AdminLayout` behind `AdminGuard`.
- `lib/<feature>.ts` — typed API clients built on `api` (`get`/`getPaged`/`post`/`patch`/`put`/`delete`/`upload`) from `lib/client.ts`. `getPaged` returns `{ data, pagination }`.
- Server state via TanStack Query; query keys are namespaced (`['admin']`, etc.) and invalidated wholesale on mutations. Global UI state via zustand (`stores/auth-store.ts`, `stores/ui-store.ts`).
- `components/<feature>/` holds feature UI; `components/ui/` is the shared primitive kit.

### i18n

`i18next` + `react-i18next`, namespaces = one JSON per feature under `src/i18n/locales/{zh-CN,en-US}/`. `zh-CN` is the default and the source of truth. Add keys to **both** languages; `scripts/check-i18n-keys.cjs` will fail if a referenced key is missing. Locale files are auto-loaded by glob in `i18n/index.ts` — a new namespace must also be added to that file's `NAMESPACES` array. UI copy and server messages are Chinese; roles/enums have dedicated namespace files (`enums`, `errors`).

## Versioning

Version is duplicated in `server/package.json` and `frontend/package.json`; `frontend/vite.config.ts` injects it as `__APP_VERSION__`. Bump both together (e.g. `v0.1.NN`). **Do not modify or stage `frontend/package-lock.json`** when bumping. Each delivery is a `release/vX.Y.Z` branch.

## Secrets

`.env` is never committed (only `.env.example`). `JWT_SECRET`, `FILE_ENCRYPTION_KEY`, SMTP credentials, and `RATE_PROVIDER_KEY` must never be logged or returned by any API. Rate-provider keys are encrypted at rest (`lib/secret-cipher.ts`) and only the last 4 chars are shown. Audit-log metadata must never contain rate values or provider secrets.

## Commit / PR conventions (from project memory)

- Commit messages are **English**, first line `v0.1.NN: <summary>`, blank line, then concise `-` bullets covering all changes (no `git add -A`; stage explicit paths).
- Branch pushes directly (no `gh` CLI installed); do not push unless asked.
- Do not update `docs/plan-phase10.md` (closed).
