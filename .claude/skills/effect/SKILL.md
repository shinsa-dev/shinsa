---
name: effect
description: How Shinsa writes Effect 4 — load before writing or reviewing any code that imports `effect` (apps/cloud, and every app as it moves to Effect). The one way to write effects, schemas, errors, services and layers, resources and retries, time and ids, HTTP APIs and clients, SQL, running and tests, with right/wrong pairs and the lint rules that enforce them. Every pattern here is compiled and tested in `scripts/effect-guide/`.
---

# Effect in Shinsa

Shinsa is written in Effect 4 (`effect` pinned at **4.1.1**, the same exact version in every workspace; an upgrade moves them all at once). Effect gives three things plain TypeScript cannot: every failure is in the type (`Effect<A, E, R>`), every shape is one schema that is type, validator and encoder at once, and every dependency is a service the compiler makes you provide. This skill is the house style on top of it. When it is silent, follow Effect's own guide in the installed package (`node_modules/effect/AGENTS.md` and `node_modules/effect/ai-docs/src`), never a blog post or an older version's docs: v4 renamed much of v3.

`conventions` still applies (no comments, the verb catalog, where things live, tests and coverage). `CLAUDE.md` wins over both; fix the drift in the same change.

**Every pattern below is real code.** `scripts/effect-guide/` compiles and runs each one: `domain.ts` (schemas, ids, errors, decoding), `machines.ts` (a service over SQL), `tunnel.ts` (a resource with a timeout and a retry schedule), `api.ts` and `handlers.ts` (an HttpApi with an auth middleware, served as a web handler), `harness.ts` and the tests beside them. When a pattern here changes, change that code and its test in the same change.

## What is Effect code

All code that does I/O, holds a resource, reads time, config or randomness, or crosses a boundary (HTTP, SQL, a process, a socket, a file) is Effect code. Every shape that crosses a boundary is a `Schema`.

**Pure logic stays plain functions.** Core's `decide`, the folds and the derivations take values and return values: they use Schema types and return a `Result` instead of throwing once they move, but they are not wrapped in `Effect.succeed`, take no services and never `yield*`. Wrapping pure code in an Effect adds a runtime and hides nothing. Effect code calls pure code directly.

## Imports

```ts
// right
import { Clock, Context, Effect, Layer, Option, Schema } from 'effect';
import { HttpApiBuilder } from 'effect/http-api';
import { SqlClient, SqlSchema } from 'effect/sql';
import { camelToSnake } from 'effect/String';
```

- Modules by name from `effect`; subsystems from their subpath (`effect/http`, `effect/http-api`, `effect/sql`, `effect/testing`, `effect/process`, `effect/crypto`, `effect/encoding`, `effect/observability`).
- A module whose name shadows a global (`String`, `Array`, `Number`, `Boolean`, `Record`, `Function`) is imported as functions from its subpath (`import { camelToSnake } from 'effect/String'`), so no file shadows a global (Biome's `noShadowRestrictedNames`).
- Drivers and platforms are `@effect/*` at the same version: `@effect/sql-d1` in the Worker, `@effect/sql-sqlite-bun` in the engine and in tests, `@effect/platform-bun` for the engine's runtime.
- No aliases, no namespace imports (`import * as E`). The lint rules below match `Effect.`, `Schema.` and the rest by name.

## File layout

A module is a folder. Its shapes and its logic live in separate files, and a logic file holds exactly one thing.

```
routes/teams/                       store/machines/
├── schema.ts    the shapes          ├── schema.ts    Machine, NewMachine, the row schemas, MACHINE_COLUMNS
└── handler.ts   TeamsHandlers       └── service.ts   Machines (the service and its layer)
```

- **`schema.ts`** holds every `Schema`, the types derived from them, the module's tagged errors, its interfaces and its constants (limits, TTLs, URLs, cookie names). No function and no effect: a conversion between two shapes is a schema transform (`Schema.decodeTo(Target, SchemaTransformation.transform({ decode, encode }))`), so it is decoded and encoded in one place, never a `resolveX` helper beside the schema.
- **`handler.ts`** (an HttpApi group or a set of plain routes), **`service.ts`** (a service and its layer) and **`middleware.ts`** hold one export and nothing beside it: no helper above it, no constant, no type. Its steps live **inside** its body, after the services it yields once, so each step sees them without yielding them again. Plain routes are `Layer.unwrap(Effect.gen(function* () { …; return Layer.mergeAll(HttpRouter.add(…)) }))`; an HttpApi group's steps go in `HttpApiBuilder.group`'s builder.
- **Read untrusted input with a schema, never by hand.** A webhook body, a cookie, a third party's answer is a `Schema.Struct` of the fields the code reads (`Schema.NonEmptyString` for an id, `Schema.optionalKey(Schema.Never)` for a field that must be absent, `Schema.Literal` for a type tag), decoded once with `Schema.decodeUnknownOption` or `Effect`. No `readString(fields, 'key')` helpers.
- **A step two modules need is a module of its own**, named for what it does and exporting peers only (`domain/machines.ts`: `removeMachine`, `createConnectAnswer`; `auth/tokens.ts`: `createSession`, `selectRequestUser`; `http/cookies.ts`: `serializeCookie`). A module like that has no private helper above its exports.
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
- A generator with nothing to `yield*` is not an effect function: return `Effect.succeed(value)` or `Effect.sync(() => …)` (Biome's `useYield` catches it).
- A promise API is entered once, in `Effect.tryPromise({ try, catch })` with the rejection mapped to a tagged error; `Effect.promise` only for one that cannot reject. Nothing else awaits, chains `.then`, or builds a `new Promise`; a callback API is `Effect.callback` with a finalizer that cancels it.
- Code that may throw (a library, `new URL`) goes in `Effect.try({ try, catch })`. Effect code itself never throws and never catches.
- Add behaviour with combinators: `Effect.timeout`, `Effect.retry`, `Effect.withSpan`, `Effect.annotateLogs`, `Effect.tap`.

## Schemas

```ts
// right: the schema is the only definition; the type comes from it
export const MachineId = Schema.String.check(Schema.isPattern(/^[a-z0-9-]{3,64}$/)).pipe(Schema.brand('MachineId'));
export type MachineId = typeof MachineId.Type;

export class Machine extends Schema.Class<Machine>('shinsa/guide/Machine')({
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
- Every limit lives in the schema (`isMaxLength`, `isPattern`, `isInt`), so the check, the type and the error message are the same everywhere it is used.
- Decode untrusted input once, at the edge, into the typed value; inside, everything is already typed. Hoist decoders (`const decodeX = Schema.decodeUnknownEffect(X)`) instead of building one per call. Text is decoded with `Schema.fromJsonString(Shape)`, never `JSON.parse`.
- Map a decode failure to the edge's own tagged error (`InvalidPayload`), never pass a `SchemaError` to a caller who cannot act on it.
- Runtime checks use the `Predicate` module (`Predicate.isObject`, `Predicate.hasProperty`), never a hand-rolled `isRecord`.

## Errors

```ts
// right
export class MachineNotFound extends Schema.TaggedError<MachineNotFound>()(
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

- Anything that must be closed (a process, a socket, a tunnel, a database, a timer) is acquired with `Effect.acquireRelease` in a layer or a scope, so closing the scope, a failure or an interruption releases it. No `stop()` methods, no `finally` blocks, no `setInterval`.
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

`bun lint:conventions` checks every source file that imports `effect` or `@effect/*` (never tests), `apps/cloud` included, with `scripts/lint-effect.ts`:

| Caught | Write instead |
|---|---|
| `throw` | `return yield* new SomeError(…)` |
| `try` / `catch` | `Effect.try`, `Effect.tryPromise`, `Effect.catchTag` |
| `await`, `async`, `new Promise`, `.then` / `.catch` / `.finally` outside `Effect.try`, `Effect.tryPromise` or `Effect.promise` | `Effect.gen`, `Effect.fn` |
| a function that only returns `Effect.gen` | `Effect.fn('name')(function* () { … })` |
| `.pipe` after `Effect.fn` | combinators as more arguments to `Effect.fn` |
| `Data.TaggedError`, `Data.Error` | `Schema.TaggedError` |
| `Date.now()`, `new Date()` | `Clock`, `DateTime` |
| `JSON.parse` | `Schema.fromJsonString(Shape)` |
| anything beside the one export of a `handler.ts`, `service.ts` or `middleware.ts` | its steps inside the export's body, its shapes and constants in `schema.ts` |
| a function or an effect in a `schema.ts` | a schema transform, or the step next to the code that runs it |

Biome adds `noConsole`, `useYield`, `noShadowRestrictedNames` and the rest of the house set.
