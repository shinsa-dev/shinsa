---
name: conventions
description: Polis code conventions — load before writing or reviewing code anywhere in this monorepo. The API's route/domain/response patterns, the dashboard's loader/action model, the verb catalog, observability, and readability style, with right/wrong examples. Complements the terse rules in CLAUDE.md.
---

# Polis conventions

`CLAUDE.md` carries the law; this skill carries the worked examples. When they disagree, `CLAUDE.md` wins, and fix the drift in the same change. For what a page shows and why, load `polis-dashboard`. For user-facing strings, load `copy`. The structure is copied from `../buzzkit` and `../cs`; when something here is silent, do what they do.

## Repo shape

| Path | What it is |
|---|---|
| `apps/api` | Cloudflare Worker, Elysia + `CloudflareAdapter`. Owns D1, secrets, auth, `/v1`, the crons. No `app.listen()`, no `fs`, no `process.env`. |
| `apps/web` | React Router 8 SSR on a Worker. Renders; calls the API; holds nothing. |
| `packages/core` | Money, FX, crypto, period maths, ledger, rollup, recurring costs. No Worker globals. |
| `packages/connectors` | Superwall and SideShift clients, fixtures and syncs. One directory per connector; a connector with several concerns gets one sub-directory per concern with its own barrel (`sideshift/{catalog,posts,spend}`). |
| `packages/attribution` | The attribution model. Pure maths, imports nothing from the workspace. |
| `packages/database` | Drizzle schema over D1, migrations in `drizzle/`. |
| `packages/eden` | Wire types re-exported from the API's `types.ts` / `serialize.ts`. |
| `packages/auth` | better-auth config. |
| `packages/observability` | `createBufferedLogger`, `createTraceRunner`, `createInstrument`. |
| `packages/ui` | The design system, vendored from buzzkit. |

## apps/api — thin routes, fat domain

A route file mirrors its URL (`src/modules/v1/metrics/platforms/index.ts` → `GET /v1/metrics/platforms`), is always `index.ts`, and holds nothing but the Elysia instance.

```ts
// right: scope in the guard, domain call, mask/serialize, envelope
export const metrics = new Elysia()
  .use(auth)
  .guard({ scope: 'dashboard:read', query: RangeQuerySchema, detail: { tags: ['Metrics'] } })
  .get('/metrics', async ({ db, viewer, workspace, query }) => {
    const result = await resolveTotals(db, workspace.id, query.from, query.to);
    return Response.success(maskTotals(result, hasScope(viewer.scopes, 'money:read'))).send();
  });
```

```ts
// wrong: SQL in the route, a helper defined beside it, a hand-built response
export const metrics = new Elysia().get('/metrics', async ({ query }) => {
  const rows = await db.all(sql`select …`);
  return { ok: true, rows };
});
```

- Every route declares **one** scope. Two verbs on one path with different scopes put the scope on each handler (`{ scope: 'money:write', body: … }`), not on the guard.
- URLs follow the resource map in `apps/api/CLAUDE.md`: plural kebab nouns, actions as `POST` to a sub-resource (`/connections/:id/syncs`), read models under `/metrics` and `/spend`.
- Register every leaf in `modules/v1/index.ts` under a `/* /v1/path */` comment. Parents never `.use()` children.
- Repeated query/params shapes are named schemas: shared ones in `libs/schemas.ts` (`RangeQuerySchema`, `BucketQuerySchema`, `IdParamsSchema`), resource ones in `api/<resource>/schemas.ts`.
- Responses: `Response.success(x).send()`, `Response.list(items).send()`, `.status(201).send(set)` for creates, `markDeleted(x)` for DELETE. Dates serialize to ISO strings in the envelope.

The domain directory is `api/<resource>/`: `index.ts` (primary queries + re-exports of every sibling), `types.ts`, `schemas.ts`, `serialize.ts`, `mask.ts` when money is involved, and concept files named for their concern (`connections/sync.ts`, `connections/sources.ts`, `members/setup.ts`). Importers use the barrel (`@/api/members/index`); siblings import each other directly.

**`types.ts` and `serialize.ts` never import through `@/`.** `packages/eden` re-exports them into the dashboard by relative path, where `@/` resolves to the dashboard. Package and sibling imports only.

## The verb catalog

| Verb | Contract |
|---|---|
| `find*` | one row or value, **throws** `NotFoundError` / `UnavailableError` when absent |
| `select*` | one row, returns `null` when absent |
| `list*` | many rows (including series) |
| `count*` | a total |
| `resolve*` | derive a value: an aggregate (`resolveTotals`), an input (`resolveRecurringInput`), a stamp |
| `create*` / `update*` | plain writes |
| `upsert*` / `replace*` / `write*` | idempotent writes |
| `softDelete*` · `remove*` | soft delete · take something away (a membership) |
| `assert*` | invariant check that throws, returns `void` |
| `serialize*` · `mask*` | response shape · money redaction by scope |
| `request*` · `sync*` · `apply*` · `record*` | outbound call · connector run · effects |

Banned in `apps/api/src` and `packages/**`: `get*`, `fetch*`, `set*`, `load*`, `delete*`, `destroy*` (lint-enforced). The dashboard's `api.server.ts` follows the catalog too (`findTotals`, `listSeries`, `createMember`, `removeRecurringCost`). If you null-check a `find*`, it should have been a `select*`.

## Observability

- Every unit of work is `trace('resource.verb', attrs?, async (span) => …)`: two segments, static, mirroring the function (`members.create`, `connections.sync`). Provider, source and outcome are attributes, never part of the name. `scheduler.*` is the one interpolated family, and only `sweep()` uses it.
- Stamp outcomes: `span.set('member.role', role)`, counts from sweeps.
- Logs: `log.info/warn/error('[Prefix] Sentence', fields)` with every id in scope and `error: describeError(error)`. Never `console` outside `api.server.ts`'s one annotated failure log and `scripts/`.
- A `catch` rethrows, converts to a typed result, or logs with context. `.catch(() => undefined)` is a silent swallow and is not allowed.

## apps/web — loaders are the source of truth

```ts
// right
export async function loader({ request, context }: Route.LoaderArgs) {
  const { ctx, scope } = await resolveScope(request, context);
  requireScope(scope, 'money:read');
  const current = { from: scope.range.from, to: scope.range.to };
  const [totals, payees] = await Promise.all([findTotals(ctx, current), listSpendPayees(ctx, current)]);
  return { scope, totals, payees };
}
```

- `lib/api.server.ts` is the only API caller. `lib/actions/*.server.ts` holds every action; the route's `action` is one line calling it. Actions return `{ error }` for an `ApiError` and throw the rest.
- Types come from `@shinsa/eden`. A missing type is exported from the API and re-exported there, never re-declared.
- `viewer.money ? findSpendBreakdown(ctx, range) : Promise.resolve({})` is fine: a ternary picking which promise to start. `viewer.money ? await x() : y` is not.
- Components live in the route file unless two routes use them; shared ones go to `components/<area>/`, reusable-beyond-Polis ones to `packages/ui`.

## Readability

1. **No comments.** A comment is a name you have not found, a function you have not extracted, or a paragraph that belongs in `docs/`.
2. **Never wrap a call chain in a ternary.** Guards and early returns.
3. **Multi-line arrow bodies get a block and an explicit `return`.** One-liners stay expressions.
4. **Blank lines separate phases in long functions only.** A guard and a return read as one unit.
5. **No single-use constants.** A value gets a name when it is reused or is a tunable (`PAYEE_LIMIT`, `SETUP_LINK_TTL_SECONDS`).
6. **No dead parameters.** When a filter stops being meaningful (per-app scoping), remove it from the signature rather than passing `null` forever.

## Data rules

- Money is integer minor units end to end.
- Days are `YYYY-MM-DD` strings; D1 timestamps are integer epochs, read with `isoDay` / `epochMillis` from `apps/api/src/utils/sql.ts`.
- A write that moves a number marks its days dirty and runs `rollupPending`, scoped to the days it touched.
- Soft delete (`deletedAt`) for domain rows; auth sessions are the one hard delete, because revoking them is the point.

## Before you finish

```sh
bunx biome check --write .     # lint, format, Grit plugins
bun lint                       # + comments ban + verb catalog
bun check-types
bun run test
bunx knip
bun dev                        # sign in, open every page you touched, read the browser console
```

Other agents work in this tree. Check `git status --short` and leave their files alone.
