---
name: effect
description: How Shinsa writes Effect 4 — load before writing or reviewing any code that imports `effect` (apps/engine, apps/cloud, apps/desktop and the I/O helpers of apps/web). The one way to write effects, schemas, errors, services and layers, resources and retries, time and ids, HTTP APIs and clients, SQL, running and tests, with right/wrong pairs and the lint rules that enforce them. Every pattern here is compiled and tested in `scripts/effect-guide/`.
---

# Effect in Shinsa

Shinsa is written in Effect 4 (`effect` pinned at **4.1.1**, the same exact version in every workspace; an upgrade moves them all at once). Effect gives three things plain TypeScript cannot: every failure is in the type (`Effect<A, E, R>`), every shape is one schema that is type, validator and encoder at once, and every dependency is a service the compiler makes you provide. This skill is the house style on top of it. When it is silent, follow Effect's own guide in the installed package (`node_modules/effect/AGENTS.md` and `node_modules/effect/ai-docs/src`), never a blog post or an older version's docs: v4 renamed much of v3.

`conventions` still applies (no comments, the verb catalog, where things live, tests and coverage). `CLAUDE.md` wins over both; fix the drift in the same change.

**Every pattern below is real code.** `scripts/effect-guide/` compiles and runs each one: `domain.ts` (schemas, ids, errors, decoding), `budget.ts` (pure code: `Option`, `Result`, `Match`, the branded `Usd` and `Percent`, text decoded without an effect), `watch.ts` (a timer as a named `Schedule`), `machines.ts` (a service over SQL), `tunnel.ts` (a resource with a timeout and a retry schedule), `api.ts` and `handlers.ts` (an HttpApi with an auth middleware, served as a web handler), `harness.ts` and the tests beside them. When a pattern here changes, change that code and its test in the same change.

## What is Effect code

All code that does I/O, holds a resource, reads time, config or randomness, or crosses a boundary (HTTP, SQL, a process, a socket, a file) is Effect code. Every shape that crosses a boundary is a `Schema`.

**I/O is Effect code whether it is synchronous or not.** A file is read and written through `FileSystem` and `Path` from `effect` (`BunServices.layer` provides them), a process runs through the engine's `Shell` (`scripts/kit`'s `Command` in a script), and a promise API is entered with `Effect.tryPromise`. `existsSync`, `readFileSync`, `Bun.spawnSync` or `Bun.which` in a plain function is I/O outside Effect even though it returns at once: its failure is a throw, not a type, and a test cannot replace it. `node:path`, `node:url` and other pure helpers stay plain.

**Pure logic stays plain functions.** Core's `decide`, the folds and the derivations take values and return values: they use Schema types and return a `Result` instead of throwing (`decide` returns `Result<Decision, DomainError>`), but they are not wrapped in `Effect.succeed`, take no services and never `yield*`. Wrapping pure code in an Effect adds a runtime and hides nothing. Effect code calls pure code directly. How pure code says "nothing", "failed" and "one of these" is under Pure code below.

**React components stay plain React.** A component renders synchronously and is never an effect. It reaches I/O through its app's one `ManagedRuntime`: the web app's `runApp` and `forkApp` (`apps/web/src/lib/runtime/app.ts`), the promise methods `lib/` exports and `useAppEffect`, which interrupts its effect on unmount. That is the bridge Effect's integration guide gives for framework hooks (`node_modules/effect/ai-docs/src/04_integration`). Effect's `effect/reactivity` atoms with `@effect/atom-react` are the other documented path; Shinsa does not use them, and moving to them is a decision for the whole web app, never one screen.

## Imports

```ts
// right
import { Clock, Context, Effect, Layer, Option, Schema } from 'effect';
import { HttpApiBuilder } from 'effect/http-api';
import { SqlClient, SqlSchema } from 'effect/sql';
import { camelToSnake } from 'effect/String';
```

- Modules by name from `effect`; subsystems from their subpath (`effect/http`, `effect/http-api`, `effect/sql`, `effect/testing`, `effect/process`, `effect/crypto`, `effect/encoding`, `effect/observability`).
- A module whose name shadows a global (`String`, `Array`, `Number`, `Boolean`, `Record`, `Function`) is imported as functions from its subpath (`import { camelToSnake } from 'effect/String'`), so no file shadows a global (Oxlint's `no-shadow-restricted-names`).
- Drivers and platforms are `@effect/*` at the same version: `@effect/sql-d1` in the Worker, `@effect/sql-sqlite-bun` in the engine and in tests, `@effect/platform-bun` for the engine's runtime.
- No aliases, no namespace imports (`import * as E`). The lint rules below match `Effect.`, `Schema.` and the rest by name.

## File layout

A module is a folder. Its shapes and its logic live in separate files, and a logic file holds exactly one thing.

**One layout in every package and app.** Core, the engine, the Worker, the web app and the desktop app all use it: a folder per module, its shapes in `schema.ts`, its logic in `handler.ts`, `service.ts` or `middleware.ts` (or one pure module named for its concern), the same names for the same roles. A move to Effect never invents a layout of its own for one app or code path; when one fits badly, change this section for every app at once.

**Rewrite into Effect, never translate.** A move is not the same code with `Effect.gen` around it: a hand-written check becomes a schema, a thrown error a tagged error in the type, a module-level singleton a service with its layer, a `try`/`finally` a scoped resource, a retry loop a `Schedule`, a callback or event emitter a `Stream`, an ad hoc timeout `Effect.timeout`. Redesign a module when Effect has the better shape for it; behaviour and the tests' expectations stay.

```
routes/teams/                       store/machines/
├── schema.ts    the shapes          ├── schema.ts    Machine, NewMachine, the row schemas, MACHINE_COLUMNS
└── handler.ts   TeamsHandlers       └── service.ts   Machines (the service and its layer)
```

- **`schema.ts`** holds every `Schema`, the types derived from them, the module's tagged errors, its interfaces and its constants (limits, TTLs, URLs, cookie names). No function and no effect: a conversion between two shapes is a schema transform (`Schema.decodeTo(Target, SchemaTransformation.transform({ decode, encode }))`), so it is decoded and encoded in one place, never a `resolveX` helper beside the schema.
- **`handler.ts`** (an HttpApi group or a set of plain routes), **`service.ts`** (a service and its layer) and **`middleware.ts`** hold one export and nothing beside it: no helper above it, no constant, no type. Its steps live **inside** its body, after the services it yields once, so each step sees them without yielding them again. Plain routes are `Layer.unwrap(Effect.gen(function* () { …; return Layer.mergeAll(HttpRouter.add(…)) }))`; an HttpApi group's steps go in `HttpApiBuilder.group`'s builder.
- **Read untrusted input with a schema, never by hand.** A webhook body, a cookie, a third party's answer is a `Schema.Struct` of the fields the code reads (`Schema.NonEmptyString` for an id, `Schema.optionalKey(Schema.Never)` for a field that must be absent, `Schema.Literal` for a type tag), decoded once with `Schema.decodeUnknownOption` or `Effect`. No `readString(fields, 'key')` helpers.
- **A step two modules need is a module of its own**, named for what it does and exporting peers only (`domain/machines.ts`: `removeMachine`, `createConnectAnswer`; `auth/tokens.ts`: `createSession`, `selectRequestUser`; `http/cookies.ts`: `serializeCookie`). A module like that has no private helper above its exports.
- Core follows the same split: each folder keeps its shapes in its `schema.ts` (`commands/schema.ts`, `report/schema.ts`, `protocol/schema.ts`…) and its parsers, validators and decoders in the logic file beside it; the builders the schemas are made of (`domain/fields.ts`, `report/reading.ts`) are pure modules of their own.
- A pure module of functions (`http/cookies.ts`, `routes/previews/address.ts`) is plain TypeScript and that is right: pure code is never wrapped in an effect. What makes it clean is that it is one concern, named for it.

```ts
// wrong: a helper, a constant and a hand-written reader above the export
const ok = { ok: true as const };
function readString(fields: Record<string, unknown>, key: string) { … }
export const SlackEventRoutes = Layer.mergeAll(HttpRouter.add('POST', path, respondEvents));

// right: schema.ts has MentionEnvelope; handler.ts holds one export, its steps inside
export const SlackEventRoutes = Layer.unwrap(
  Effect.gen(function* () {
    const store = yield* SlackStore;
    const decodeMention = Schema.decodeUnknownOption(MentionEnvelope);
    const respondEvents = Effect.gen(function* () { … });
    return HttpRouter.add('POST', SLACK_RELAY_PATHS.events, respondEvents);
  })
);
```

`apps/cloud` is the reference: every folder under `src/` follows this.

## Writing effects

```ts
// right: a reusable function is Effect.fn, named for its span; errors are returned with yield*
const find = Effect.fn('Machines.find')(function* (id: MachineId) {
  const machine = yield* select(id);
  if (Option.isNone(machine)) return yield* new MachineNotFound({ machineId: id });
  return machine.value;
});
```

```ts
// wrong: a function that only returns Effect.gen, a .pipe after Effect.fn, async/await
const find = (id: MachineId) => Effect.gen(function* () { … });
const pair = Effect.fn('Machines.pair')(function* () { … }).pipe(Effect.orDie);
const open = async () => { await connect(); };
```

- `Effect.gen` for inline code; `Effect.fn('Service.method')` for every reusable function, named exactly like the service and method so traces read as the code; `Effect.fnUntraced` only on hot paths that are not a useful span.
- Combinators for an `Effect.fn` go in as extra arguments, `Effect.fn('a')(function* () { … }, Effect.orDie)`, never as a `.pipe` after it.
- `return yield* new SomeError(…)` to fail, so TypeScript knows the branch ends.
- A generator with nothing to `yield*` is not an effect function: return `Effect.succeed(value)` or `Effect.sync(() => …)` (Oxlint's `require-yield` catches it).
- A promise API is entered once, in `Effect.tryPromise({ try, catch })` with the rejection mapped to a tagged error; `Effect.promise` only for one that cannot reject. Nothing else awaits, chains `.then`, or builds a `new Promise`; a callback API is `Effect.callback` with a finalizer that cancels it.
- Code that may throw (a library, `new URL`) goes in `Effect.try({ try, catch })`. Effect code itself never throws and never catches.
- Add behaviour with combinators: `Effect.timeout`, `Effect.retry`, `Effect.withSpan`, `Effect.annotateLogs`, `Effect.tap`.

## Schemas

```ts
// right: the schema is the only definition; the type comes from it
export const MachineId = Schema.String.check(Schema.isPattern(/^[a-z0-9-]{3,64}$/)).pipe(Schema.brand('MachineId'));
export type MachineId = typeof MachineId.Type;

export class Machine extends Schema.Class<Machine, { readonly brand: unique symbol }>('shinsa/guide/Machine')({
  id: MachineId,
  name: Schema.NonEmptyString.check(Schema.isMaxLength(64)),
  status: Schema.Literals(['online', 'offline']),
  pairedAt: Schema.Int,
}) {}

const decodePairRequestText = Schema.decodeUnknownEffect(Schema.fromJsonString(PairRequest));
```

```ts
// wrong: a hand-written type beside a hand-written check, JSON.parse, a predicate per field
interface Machine { id: string; name: string }
const body = JSON.parse(text);
if (typeof body.name !== 'string' || body.name.length > 64) …
```

- **One schema per shape, defined once, imported everywhere.** The type is `typeof X.Type` (and `typeof X.Encoded` for the wire form); a hand-written interface beside a schema is a second definition and drifts. Reuse fields (`Machine.fields.name`) instead of restating a check.
- `Schema.Class` for a domain record, `Schema.Struct` for a payload, `Schema.Literals` for a closed set, `Schema.TaggedStruct` and `Schema.Union` for variants. Every id is branded (`Schema.brand('TaskId')`); build one in a test with `TaskId.make('…')`.
- Every `Schema.Class`, `Schema.TaggedClass` and `Schema.TaggedError` takes a brand as its second type argument (`{ readonly brand: unique symbol }`), so two classes of the same shape never pass for each other (`schemaClassMissingBrand`, an error in `bun check-types`). A subclass never overrides the constructor (`overriddenSchemaConstructor`): build one with a `static create` that returns `Object.assign(new X({ … }), { … })`, its extra fields `declare readonly`.
- Every limit lives in the schema (`isMaxLength`, `isPattern`, `isInt`), so the check, the type and the error message are the same everywhere it is used.
- Decode untrusted input once, at the edge, into the typed value; inside, everything is already typed. Hoist decoders (`const decodeX = Schema.decodeUnknownEffect(X)`) instead of building one per call. Text is decoded with `Schema.fromJsonString(Shape)`, never `JSON.parse`.
- Map a decode failure to the edge's own tagged error (`InvalidPayload`), never pass a `SchemaError` to a caller who cannot act on it.
- Runtime checks use the `Predicate` module (`Predicate.isObject`, `Predicate.hasProperty`), never a hand-rolled `isRecord`.

## Errors

```ts
// right
export class MachineNotFound extends Schema.TaggedError<MachineNotFound, { readonly brand: unique symbol }>()(
  'MachineNotFound',
  { machineId: MachineId },
  { httpApiStatus: 404 }
) {}

machines.find(id).pipe(Effect.catchTag('MachineNotFound', () => Effect.succeed(null)));
```

- **Every expected failure is a `Schema.TaggedError`**, named for what happened (`MachineNotFound`, `PairingExpired`, never `Error2` or `CloudError` with a code string), with the fields a caller needs to act. `Data.TaggedError` is not used: a schema error can be encoded and cross a boundary.
- An error that reaches HTTP carries `httpApiStatus`. The status is part of the error's definition, not decided in a handler.
- **Typed errors are failures a caller can act on. Everything else is a defect.** A SQL failure, a stored row that breaks its schema, a broken invariant: `Effect.orDie` at the service's edge, so it never pollutes a signature. The process edge logs every defect and answers with a 500.
- A service with many kinds of failure gives one error with a `reason` union (`reason: Schema.Union([RateLimited, QuotaExceeded])`); callers pick with `Effect.catchReason` / `catchReasons`, or `Effect.unwrapReason` to lift the reasons.
- Handle errors with `Effect.catchTag` / `catchTags` by tag, never with `instanceof` or by reading `message`.
- **The verb catalog in Effect**: `find*` fails with a `*NotFound` error; `select*` succeeds with an `Option`; `assert*` fails with a tagged error and succeeds with `void`; `parse*` decodes text with a schema and fails with the edge's invalid-input error. The other verbs keep their meaning.

## Pure code

```ts
// right: plain functions over schemas; the empty case, the failure and every variant are values the caller must handle
export function selectBudgetShare(spend: Spend): Option.Option<Percent> {
  if (spend.budget === 0) return Option.none();
  return Option.some(Percent.make(Math.min(100, (spend.spent / spend.budget) * 100)));
}

export function applyCharge(spend: Spend, cost: Usd): Result.Result<Spend, BudgetExceeded> { … }

export const resolveBudgetLabel = Match.type<BudgetState>().pipe(
  Match.tagsExhaustive({ Unlimited: () => 'No budget', Within: ({ share }) => `${Math.round(share)}% used`, Over: () => 'Over budget' })
);

const decodeSpendText = Schema.decodeUnknownResult(Schema.fromJsonString(Spend));
```

```ts
// wrong: null for nothing, a throw for a failure the caller expects, a switch that compiles when a variant is added, JSON.parse
export function selectBudgetShare(spend: Spend): number | null { … }
if (spent > budget) throw new Error('Over budget');
const spend = JSON.parse(text) as Spend;
```

Pure code (core's `decide`, the folds, costs, forecast, queue, the briefing and the report validators, and the pure helpers of the engine and the web app) runs on every command and on every replay of the log, so it stays synchronous and plain: never `Effect.gen`, `Effect.runSync` or a service. It still says what can go wrong in its type (`budget.ts`):

- **Nothing is `Option`, never `null`.** An exported function that may find nothing returns `Option<A>` (`Option.none()`, `Option.some(value)`), so a caller cannot forget the empty case; `select*` names it. A React prop or a stored field may stay `null` where its schema says so (`Schema.NullOr`); the rule is about what a function returns.
- **A failure the caller must handle is a `Result`.** `Result.succeed(value)` or `Result.fail(new SomeError(…))` with a `Schema.TaggedError`, never a `throw` and never an ad hoc `{ ok, error }` object. Code that throws (a third-party parser) is entered with `Result.try({ try, catch })`. `decide` returns `Result<Decision, DomainError>` this way.
- **A union is matched exhaustively.** `Match.type<Union>().pipe(Match.tagsExhaustive({ … }))` or `Match.valueTags`, so adding a variant breaks the build where it is not handled. A `switch` over `_tag` is fine only when TypeScript's `never` check closes it.
- **Numbers that must not mix are branded.** Money is `Usd`, a share is `Percent` (`Schema.Finite` with its check and `Schema.brand`), ids are branded already, so a percent never lands where dollars belong. `X.make(value)` throws on a value that breaks the check: use it on values the code computes or a test writes, and decode anything from outside.
- **Text from outside is decoded, not parsed.** `Schema.decodeUnknownResult(Schema.fromJsonString(Shape))` in pure code, `Schema.fromJsonString` with `decodeUnknownEffect` in an effect; never `JSON.parse` and a cast.

## Services and layers

```ts
// right
export class Machines extends Context.Service<
  Machines,
  {
    find(id: MachineId): Effect.Effect<Machine, MachineNotFound>;
    readonly list: Effect.Effect<ReadonlyArray<Machine>>;
  }
>()('shinsa/guide/Machines') {
  static readonly layer = Layer.effect(
    Machines,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      …
      return Machines.of({ find, list });
    })
  );
}
```

- A service is `Context.Service<Self, Shape>()('shinsa/<package>/<folder>/<Name>')`, its shape written in the class and its methods returning effects with no requirements of their own: what a service needs is required by its layer, never by its methods.
- `static readonly layer` builds the one implementation from the services it needs (`yield* SqlClient.SqlClient`), visible in its type. Layers are composed once, at the app's composition root, with `Layer.provide` (hide the dependency) or `Layer.provideMerge` (expose it too).
- **One implementation per service.** Tests replace what a service depends on (SQLite in memory for SQL, a test layer for GitHub or Cloudflare), never write a second copy of the service's own logic. A service that *is* the outside world (a GitHub client, a tunnel connector) is the one that gets a test layer, which plays that world.
- Configuration is `Config.*` read in a layer (`Config.Redacted('GITHUB_CLIENT_SECRET')`); a value with a default is a `Context.Reference`. Nothing reads `process.env` or a Worker binding outside the composition root.
- **A secret is `Redacted` from the moment it is read** until the one call that sends it (`Redacted.value` there and nowhere else). It is never logged, never put in an error and never compared with `===`: compare with a constant-time equivalence (`Redacted.makeEquivalence`, see `handlers.ts`).

## Resources, concurrency and retries

```ts
// right
const RECONNECT_SCHEDULE = Schedule.min([Schedule.exponential('1 second'), Schedule.spaced('30 seconds')]).pipe(
  Schedule.setInputType<TunnelError>(),
  Schedule.while(({ input }) => input.retryable)
);

const connect = connector.open(token).pipe(
  Effect.timeoutOrElse({ duration: CONNECT_TIMEOUT, orElse: () => new TunnelError({ … retryable: true }) }),
  Effect.retry(RECONNECT_SCHEDULE)
);
const connection = yield* Effect.acquireRelease(connect, (open) => open.close);
```

- Anything that must be closed (a process, a socket, a tunnel, a database, a timer) is acquired with `Effect.acquireRelease` in a layer or a scope, so closing the scope, a failure or an interruption releases it. No `stop()` methods, no `finally` blocks, no `setTimeout` or `setInterval`: a wait is `Effect.sleep`, a repeat is `Effect.repeat` on a named `Schedule` (`watch.ts`, tested on `TestClock`), and a component's timer runs through `useAppEffect`, so it stops when its scope closes.
- A background loop is a fiber forked in a layer (`Layer.effectDiscard` with `Effect.forkScoped`), so it stops with the app. Work a task owns is forked in that task's scope, so cancelling the task stops everything it started.
- Every retry and repeat is a named `Schedule` constant: exponential, capped with `Schedule.min` against `Schedule.spaced`, bounded with `Schedule.upTo` or `Schedule.recurs`, retried only `while` the error says it is retryable, and `Schedule.jittered` in production loops. Every wait on the outside world has a timeout.
- Concurrency is explicit: `Effect.forEach(items, f, { concurrency: 4 })`, `Effect.all`. Fan-out of events is a `PubSub` exposed as a `Stream`; a work queue is a `Queue`.

## Time, ids and randomness

- Time is `Clock.currentTimeMillis` or `DateTime.now`, never `Date.now()` or `new Date()`; a test sets it with `TestClock`.
- Ids and random values come from a service (`Random`, or the app's id service), so a test sees the same ids every run.

## HTTP

```ts
// right: one definition; the server implements it and a client is derived from it
export class MachinesGroup extends HttpApiGroup.make('machines')
  .add(
    HttpApiEndpoint.get('find', '/:id', { params: { id: MachineId }, success: Machine, error: MachineNotFound }),
    HttpApiEndpoint.post('pair', '/', { payload: PairRequest, success: Machine, error: MachineAlreadyPaired })
  )
  .middleware(Session)
  .prefix('/machines') {}
```

- **An API is declared once with `HttpApi`**, every endpoint with its params, payload, success and error schemas, where both sides can import it (core, for the cloud API). The server implements it with `HttpApiBuilder.group`; every caller gets a typed client from `HttpApiClient.make`. No hand-written route table, request parser or `fetch` wrapper next to it.
- The cloud API is `RemoteApi` in core (`remote/api.ts`), its schemas `remote/contract.ts` and its failures `remote/errors.ts`, one class per wire code whose body stays `{ error: { code, message } }` through `resolveRemoteFailureWire`. A new route, payload or failure is added there first; the Worker implements it and every client is derived from it.
- Authentication is one `HttpApiMiddleware.Service` with its `security` (`HttpApiSecurity.bearer`, a cookie), which provides the signed-in account as a service to every handler behind it. A handler never reads a header to authenticate.
- A Worker is served with `HttpRouter.toWebHandler(layer)`, which returns `{ handler, dispose }`.
- A params, query or payload failure is an `HttpApiSchemaError`, which HttpApi answers with an **empty 400**. An app whose clients need a body renders those, and every defect, in **one** error middleware; that is the only place an error body is shaped.
- An outbound call uses `HttpClient` (`FetchHttpClient.layer`) behind a service, with `HttpClient.filterStatusOk`, `HttpClient.retryTransient` on a schedule, and `HttpClientResponse.schemaBodyJson(Shape)` to decode the answer.

## SQL

- `SqlClient` with `SqlSchema.findOneOption`, `findAll` and `void`, each with a `Request` and a `Result` schema, so every row is decoded and every parameter encoded (`machines.ts`).
- The client is configured once with `transformQueryNames: camelToSnake` and `transformResultNames: snakeToCamel`, so schemas are camelCase and tables snake_case.
- Queries are the `sql` template only; values are always parameters. Never build SQL from strings, never `sql.unsafe` with anything that came from outside.
- Writes that must happen together go in `sql.withTransaction`. The Worker runs `@effect/sql-d1`; tests run `@effect/sql-sqlite-bun` in memory against the same migration files.

## Running and observability

- **One runtime per process, at its edge**: the engine's `main` runs its app layer with `Layer.launch` and `BunRuntime.runMain`; the Worker's `fetch` is the `handler` from `HttpRouter.toWebHandler`. `Effect.runPromise` and friends appear only there and in tests.
- Logs are `Effect.logInfo` / `logWarning` / `logError` with `Effect.annotateLogs({ taskId })`; spans come from `Effect.fn` names and `Effect.withSpan`. Never `console`.

## Tests

```ts
// right: the package's runTest provides the test layers; failures are asserted with Effect.flip
test('find fails with MachineNotFound', async () => {
  const error = await runTest(Effect.flip(Machines.use((machines) => machines.find(LAPTOP))));
  expect(error._tag).toBe('MachineNotFound');
});
```

- Tests are `bun test`, not `@effect/vitest`. Each package has one `runTest` in its test harness: `Effect.runPromise(effect.pipe(Effect.provide(TestLayer)))`, with the package's test layers (`harness.ts`).
- A layer is built per test, so no state leaks between tests (`bun test --randomize` reorders them). A shared web handler is made in `beforeEach` and disposed in `afterEach`.
- Time is moved with `TestClock`: fork the effect (`Effect.forkChild`), `TestClock.adjust('10 seconds')`, then `Fiber.join` (`tunnel.test.ts`).
- Assert a failure with `Effect.flip` and its `_tag` and fields, never by message text alone.
- An HTTP API is tested through its web handler with real `Request`s (`handlers.test.ts`), so statuses, bodies and headers are what a client sees.

## Lint

Three tools check Effect code, and each catches what the others cannot:

- **The Effect language service** (`@effect/tsgo`), run by every `check-types` as `effect-tsgo tsc --noEmit` with the
  severities in `tsconfig.effect.json`: every correctness rule is an error and a warning fails the build. It reads
  types, so it catches an effect nobody runs (`floatingEffect`), a missing `yield*`, an error or a service left out of
  a signature (`missingEffectError`, `missingEffectContext`, `missingLayerContext`), `any` or `unknown` in an error
  channel, a schema class without its brand, an unstable API outside the allowed list (`effect/http`,
  `effect/http-api`, `effect/sql` and the SQL drivers, and the engine's `effect/process`, `effect/FileSystem`,
  `effect/PlatformError` and `@effect/platform-bun`), and `Data.TaggedError` (`preferSchemaTaggedError`).
- **Oxlint**, run type-aware as `effect-tsgo oxlint --type-aware` (`bun lint:oxlint`), for the house rules every file
  meets: `no-console`, `require-yield`, `no-shadow-restricted-names`, floating promises and the rest of
  `.oxlintrc.json`.
- **`scripts/lint-effect.ts`**, in `bun lint:conventions`, for what no diagnostic expresses: it checks every source
  file that imports `effect` or `@effect/*` (never tests), wherever it is, while the language service's matching
  rules only look inside a generator or at every file of the repository. Pure code that only reads Effect's data
  types is not Effect code (`isEffectCode`): a file whose one `effect` import names only `Option`, `Result`,
  `Match`, `Predicate` or `Order`, and in `packages/core/src` any file that does not import `Effect` itself, is held
  to the plain-file rules instead, so a web helper or a component can unwrap an `Option` and keep its `Date.now()`:

| Caught | Write instead |
|---|---|
| `throw` | `return yield* new SomeError(…)` |
| `try` / `catch` | `Effect.try`, `Effect.tryPromise`, `Effect.catchTag` |
| `await`, `async`, `new Promise`, `.then` / `.catch` / `.finally` outside `Effect.try`, `Effect.tryPromise` or `Effect.promise` | `Effect.gen`, `Effect.fn` |
| a function that only returns `Effect.gen` | `Effect.fn('name')(function* () { … })` |
| `.pipe` after `Effect.fn` | combinators as more arguments to `Effect.fn` |
| `Data.Error` | `Schema.TaggedError` |
| `Date.now()`, `new Date()` | `Clock`, `DateTime` |
| `JSON.parse` | `Schema.fromJsonString(Shape)` |
| anything beside the one export of a `handler.ts`, `service.ts` or `middleware.ts` | its steps inside the export's body, its shapes and constants in `schema.ts` |
| a function or an effect in a `schema.ts` | a schema transform, or the step next to the code that runs it |

It also checks every `.ts` file that does not import `effect` under `apps/*/src`, `apps/*/scripts`, `packages/*/src`, `packages/*/scripts` and `scripts/` (never tests, never `.tsx` components): an `await`, an `async` function, a `new Promise` or a promise chain there fails as Promise I/O outside Effect (`isPromiseIoSource`, `PROMISE_IO_MESSAGE`), and a value import of `node:fs`, `node:fs/promises` or `node:child_process`, or any use of `Bun.spawn`, `spawnSync`, `file`, `write`, `which` or `build`, fails as file or process I/O outside Effect (`listSyncIoLines`, `SYNC_IO_MESSAGE`; a `type` import is fine). `SYNC_IO_EXEMPT` names the few synchronous edges a caller outside Effect needs, each one small file doing nothing else: `apps/engine/src/agents/transcripts/file.ts`, whose file watcher reads a run's appended bytes and moves its offset in one synchronous step, so two reads never interleave; `apps/engine/src/eunoe/files.ts`, the thread store and request log `@chroxify/eunoe` calls synchronously; `apps/engine/src/store/evidence/image-file.ts`, the tool image a provider's result mapper stores while it maps a result synchronously (the Claude and Codex mappers run inside the SDK's message callback, so `runSync` cannot wait on `FileSystem`'s async write); `apps/engine/src/git/blobs/spawn.ts`, the `git cat-file --batch-command` process the object reader keeps open and talks to over stdin and stdout, which `Shell` (one command, one result) does not model; `apps/engine/src/agents/providers/claude/process/spawn.ts` and `apps/engine/src/agents/providers/codex/client/spawn.ts`, the Claude Code process the Agent SDK drives and the Codex app server, each kept open and talked to over stdio for a whole session; and `apps/engine/src/terminals/pty/spawn.ts`, a terminal's shell on a PTY (`Bun.spawn` with `terminal`), which `Shell` cannot open; `apps/engine/src/cli/log-file.ts`, the engine log that replaces the process's `stdout` and `stderr` writes, which Node calls synchronously; `scripts/kit/bundle.ts`, `Bun.build` for the engine and the desktop app, which Effect has no service for. A listing that needs file types uses `FileSystem.readDirectoryEntries`, never `readdir` with `withFileTypes`. A file that does import `effect` is held to the same line: every call of a `node:fs` or `node:child_process` import, or of one of those `Bun` functions, must sit inside a function passed to `Effect.try`, `Effect.tryPromise`, `Effect.promise`, `Effect.sync` or `Effect.callback`, or to a local helper that only hands its argument to one of them (`const attempt = (run) => Effect.try({ try: run, catch })`); anywhere else, such as a plain helper beside the service, it fails (`listUnbridgedIoLines`, `EFFECT_SYNC_IO_MESSAGE`). On top of that, a raw `node:fs`, `node:child_process` or `Bun` I/O call in Effect code fails even inside a bridge (`listRawIoViolations`, `RAW_IO_MESSAGE`): Effect code reads and writes through `FileSystem` and `Path` and runs processes through `Shell` or the kit's `Command`, and only the `SYNC_IO_EXEMPT` edges above touch the platform directly. The lint walks `src`, `test` and `scripts` of every folder under `apps/` and all of `packages/` and `scripts/`, so a new app is checked the day it lands. Write the module as a service with Effect.fn steps and enter the promise API with `Effect.tryPromise`; a runtime runs it only at an edge: the engine's `main.ts` (`BunRuntime.runMain`), a script's last line (`BunRuntime.runMain`), the web app's `runApp`/`forkApp`, a Worker's `fetch`, an Astro endpoint, or a test. React components stay plain React and reach I/O through those edges.

Every engine source file but `main.ts` is also checked for running effects itself: `ManagedRuntime`, `edgeRuntime`, a `.runPromise`, `.runSync`, `.runFork` or `.runCallback` call, and an exported class that is not a `Context.Service`, a `Context.Reference`, a schema class or an `Error` fail (`listEngineRuntimeLines`). A module is a service with its layer, its dependencies are yielded, and a callback from outside Effect (a Bun socket handler, a PTY event, an SDK callback) enters with `Effect.runForkWith(context)` or `Effect.runPromiseWith(context)` on the context its layer captured.

### Code outside Effect, and the baseline

Five more rules (`listBaselineRuleViolations` in `scripts/lint-effect.ts`) reach the code that does not import `effect`, over every source file under `apps/*/src`, `apps/*/scripts`, `packages/*/src`, `packages/*/scripts` and `scripts/` (never tests):

| Rule | Where | Caught | Write instead |
|---|---|---|---|
| `throw` | plain `.ts` | `throw`, but a literal `throw new DomainError(…)` in `packages/core/src` | `Option` or `Result` in pure code, a `Schema.TaggedError` in an effect (Pure code) |
| `try-catch` | plain `.ts` | `try` / `catch` | `Result.try` in pure code, `Effect.try` in an effect (Pure code) |
| `null-return` | `packages/core/src` | an exported function with a `return null` of its own | `Option` (Pure code) |
| `json-parse` | every file without `effect`, `.tsx` too | `JSON.parse` | `Schema.decodeUnknownResult(Schema.fromJsonString(Shape))` (Schemas) |
| `timer` | every source file, `.tsx` too | `setTimeout`, `setInterval` outside `Effect.callback` | `Effect.sleep`, a named `Schedule`, `useAppEffect` (Resources, concurrency and retries) |

Effect files already fail on `throw`, `try` and `JSON.parse` through the table above, and a promise in any non-`.tsx` source already fails as Promise I/O outside Effect, so those need no baseline: their count is zero and stays zero.

The code written before these rules is frozen in `scripts/lint-baseline.json`: per rule, per file, how many are left. `bun lint:conventions` fails when a file has **more** than its entry (each new line is reported with the rule's message) and when it has **fewer** (lower the entry, so the fix cannot come back). `bun scripts/lint-conventions.ts --write-baseline` rewrites the file from the current counts after a fix. `bun lint:conventions` passes `--base origin/main` and fails when any entry is higher than on that branch, or a file is added that it does not list: **the baseline only shrinks**, and a new violation is fixed, never added to the baseline (a base branch without the file, as before the first baseline merged, skips this comparison). The stacked parts of the Effect migration empty it package by package.

### What stays plain, and why

- **Pure code** (core's `decide`, the folds in `state/`, `costs`, `forecast`, `queue`, `briefing`, `report`, `prompts`; the pure helpers of the engine and the web app): plain synchronous functions, because they run on every command and every replay and an effect would only add a runtime. They use `Option`, `Result`, `Match` and branded schemas (Pure code). `decide`'s guards (`find*` and `assert*` inside `decide/`) throw a `DomainError` that `Result.try` catches at `decide`'s one boundary, so every caller still gets a `Result`. Threading `Result` through some 240 guards in 44 files would add an early return to every step and no type information, so the `throw` rule allows a literal `throw new DomainError(…)` in `packages/core/src` and nothing else there.
- **The engine's input readers** (`terminals/input.ts`, `extensions/input.ts`, `surface/fields.ts`, `files/paths.ts`, `agents/tools/forks.ts`, `agents/handover.ts`, `cli/args.ts`, `instance/targets.ts`): plain functions over a body or argv already in hand, returning a `Result` with a `DomainError` or a tagged error, never an effect, since they read nothing from outside. A route or tool yields them with `Effect.fromResult`, so a refusal keeps its code and message.
- **React components** (`.tsx`): plain props and plain promises, reaching I/O through `runApp`, `forkApp` and `useAppEffect`. They are held to the `json-parse` and `timer` rules, never to `throw` or `try-catch`, since an error boundary and an event handler are React's own failure paths.
- **The kit** (`packages/ui`): reusable React with no I/O; its timers count toward the baseline like any component's.
- **`node:path`, `node:url` and other pure helpers**: no I/O, so nothing for Effect to type.
- **The `SYNC_IO_EXEMPT` edges** above: a process, a PTY, a synchronous callback or `Bun.build` that no Effect service models, each one small file doing nothing else.
- **A brand's `make`** throws on a value that breaks its check; it is kept for values the code computes and tests, while outside input is decoded. Core's `Usd` and `Percent` (`costs/schema.ts`) are made with `createUsd` and `createPercent`, which skip the check: they run in every cost fold and render, the amounts come from provider usage already decoded at the engine's edge, and a check failing there would throw in a render. The brand is what keeps a share of the weekly limit from landing where dollars belong (`TaskBudget`, `CostLine`, `BuildEstimate`, `describeUsd`, `describeWeeklyPercent`). The forecast keeps plain numbers: it works in one unit, a share of the weekly limit, from end to end.
- **A `switch` with a `default:` that means "every other case"**: input that is not yet typed (`remote/channel.ts`, `remote/share-channel.ts`, `chat/references.ts` read unknown text), and steps over the event, command or stage unions whose other members all take the same path on purpose (`state/timing.ts`, `decide/slack.ts`, `decide/dependencies.ts`, `decide/messages.ts`, `remote/local-only.ts`, `report/reading.ts`). Listing every one of a hundred events would hide the few that matter. A closed union whose every member needs its own answer is matched exhaustively instead (`domain/issues.ts` walks Effect's `SchemaIssue` with `Match.tagsExhaustive`, `describeBudgetAmount` matches a budget's unit).
- **Stored and wire fields that are `null`**: an `Option` a core function returns is unwrapped with `Option.getOrNull` where it fills a field whose schema is `Schema.NullOr` (an event, a record, a JSON body), since `Option` is not a wire shape.
