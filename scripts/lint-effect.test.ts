import { describe, expect, test } from 'bun:test';
import {
  EFFECT_CLOCK_MESSAGE,
  EFFECT_DATA_ERROR_MESSAGE,
  EFFECT_FN_PIPE_MESSAGE,
  EFFECT_GEN_WRAPPER_MESSAGE,
  EFFECT_JSON_MESSAGE,
  EFFECT_LOGIC_FILE_MESSAGE,
  EFFECT_PROMISE_MESSAGE,
  EFFECT_SCHEMA_FILE_MESSAGE,
  EFFECT_THROW_MESSAGE,
  EFFECT_TRY_MESSAGE,
  isEffectSource,
  listEffectViolations,
} from './lint-effect.ts';

const messages = (source: string) =>
  listEffectViolations('a.ts', source).map((violation) => violation.message);

describe('Effect code is held to the house style', () => {
  test('only source files that import effect are checked, never tests', () => {
    const source = "import { Effect } from 'effect';";
    expect(isEffectSource('apps/cloud/src/routes/pair.ts', source)).toBe(true);
    expect(isEffectSource('apps/cloud/src/a.ts', "import { SqlClient } from 'effect/sql';")).toBe(true);
    expect(isEffectSource('apps/cloud/src/a.ts', "import { D1Client } from '@effect/sql-d1';")).toBe(true);
    expect(isEffectSource('apps/cloud/src/a.ts', "import { x } from 'effective';")).toBe(false);
    expect(isEffectSource('apps/cloud/test/pair.test.ts', source)).toBe(false);
    expect(isEffectSource('apps/cloud/test/harness.ts', source)).toBe(false);
    expect(isEffectSource('scripts/effect-guide/domain.test.ts', source)).toBe(false);
  });

  test('a .tsx file is parsed with JSX', () => {
    expect(messages('const a = 1;')).toEqual([]);
    expect(listEffectViolations('a.tsx', 'const view = () => <Row at={Date.now()} />;')).toEqual([
      { line: 1, message: EFFECT_CLOCK_MESSAGE },
    ]);
  });

  test('a throw and a try/catch are caught, with the line they are on', () => {
    expect(listEffectViolations('a.ts', "const a = 1;\nthrow new Error('no');")).toEqual([
      { line: 2, message: EFFECT_THROW_MESSAGE },
    ]);
    expect(messages('try { run(); } catch { stop(); }')).toEqual([EFFECT_TRY_MESSAGE]);
  });

  test('await, async functions, new Promise and promise chains are caught outside a bridge', () => {
    expect(messages('const a = async () => { await run(); };')).toEqual([
      EFFECT_PROMISE_MESSAGE,
      EFFECT_PROMISE_MESSAGE,
    ]);
    expect(messages('const a = new Promise(() => {});')).toEqual([EFFECT_PROMISE_MESSAGE]);
    expect(messages('run().then(done); run().catch(stop); run().finally(stop);')).toEqual([
      EFFECT_PROMISE_MESSAGE,
      EFFECT_PROMISE_MESSAGE,
      EFFECT_PROMISE_MESSAGE,
    ]);
    expect(messages('Effect.catch(run, stop); Stream.catch(run, stop);')).toEqual([]);
  });

  test('Effect.try, Effect.tryPromise and Effect.promise may hold the code that throws or awaits', () => {
    expect(
      messages('Effect.tryPromise({ try: async () => { await run(); throw x; }, catch: toError });')
    ).toEqual([]);
    expect(messages('Effect.tryPromise({ async try() { return await run(); }, catch: toError });')).toEqual(
      []
    );
    expect(messages('Effect.promise(async () => { await run(); });')).toEqual([]);
    expect(messages('Effect.try(() => { throw x; });')).toEqual([]);
    expect(messages('Effect.tryPromise({ try: run, catch: async () => { await stop(); } });')).toEqual([
      EFFECT_PROMISE_MESSAGE,
      EFFECT_PROMISE_MESSAGE,
    ]);
    expect(messages('Other.tryPromise(async () => { await run(); });')).toEqual([
      EFFECT_PROMISE_MESSAGE,
      EFFECT_PROMISE_MESSAGE,
    ]);
  });

  test('a function that only returns Effect.gen is caught, in both arrow forms and as a function', () => {
    expect(messages('const a = (id) => Effect.gen(function* () {});')).toEqual([EFFECT_GEN_WRAPPER_MESSAGE]);
    expect(messages('const a = (id) => { return Effect.gen(function* () {}); };')).toEqual([
      EFFECT_GEN_WRAPPER_MESSAGE,
    ]);
    expect(messages('function a() { return Effect.gen(function* () {}); }')).toEqual([
      EFFECT_GEN_WRAPPER_MESSAGE,
    ]);
    expect(messages('const a = Effect.gen(function* () {});')).toEqual([]);
    expect(messages('const a = () => { log(); return Effect.gen(function* () {}); };')).toEqual([]);
    expect(messages('class A { run() { return Effect.gen(function* () {}); } }')).toEqual([]);
  });

  test('a .pipe after Effect.fn or Effect.fnUntraced is caught, a .pipe elsewhere is not', () => {
    expect(messages("Effect.fn('a')(function* () {}).pipe(Effect.orDie);")).toEqual([EFFECT_FN_PIPE_MESSAGE]);
    expect(messages('Effect.fnUntraced(function* () {}).pipe(Effect.orDie);')).toEqual([
      EFFECT_FN_PIPE_MESSAGE,
    ]);
    expect(messages('Effect.succeed(1).pipe(Effect.orDie); run().pipe(Effect.orDie);')).toEqual([]);
  });

  test('Data.Error, the wall clock and JSON.parse are caught', () => {
    expect(messages('class A extends Data.Error {}')).toEqual([EFFECT_DATA_ERROR_MESSAGE]);
    expect(messages("class B extends Data.TaggedError('B') {}")).toEqual([]);
    expect(messages('const now = Date.now(); const at = new Date();')).toEqual([
      EFFECT_CLOCK_MESSAGE,
      EFFECT_CLOCK_MESSAGE,
    ]);
    expect(messages('const value = JSON.parse(text);')).toEqual([EFFECT_JSON_MESSAGE]);
    expect(
      messages('const text = JSON.stringify(value); const url = new URL(path); Data.struct({});')
    ).toEqual([]);
  });

  test('a handler, service or middleware file holds its one export and nothing beside it', () => {
    const one = "import { Layer } from 'effect';\nexport const Routes = Layer.empty;";
    expect(listEffectViolations('apps/cloud/src/routes/teams/handler.ts', one)).toEqual([]);
    const helper = `${one}\nconst ok = { ok: true };\nexport type Answer = string;`;
    expect(listEffectViolations('apps/cloud/src/routes/teams/handler.ts', helper)).toEqual([
      { line: 3, message: EFFECT_LOGIC_FILE_MESSAGE },
      { line: 4, message: EFFECT_LOGIC_FILE_MESSAGE },
    ]);
    expect(listEffectViolations('a/service.ts', 'const helper = 1;')).toEqual([
      { line: 1, message: EFFECT_LOGIC_FILE_MESSAGE },
    ]);
    expect(listEffectViolations('a/middleware.tsx', 'export const Gate = 1;')).toEqual([]);
    expect(listEffectViolations('a/helpers.ts', 'const a = 1;\nconst b = 2;')).toEqual([]);
  });

  test('a schema file holds schemas, types and constants, never a function or an effect', () => {
    const shapes =
      'export const LIMIT = 1;\nexport const Row = Schema.Struct({});\nexport type Row = string;';
    expect(listEffectViolations('a/schema.ts', shapes)).toEqual([]);
    expect(
      listEffectViolations(
        'a/schema.ts',
        'export function read() {}\nconst a = () => 1;\nexport const b = Effect.gen(function* () {});\nconst c = Effect.fn("c")(function* () {});\nexport const d = Schema.decodeUnknownOption(Row);'
      )
    ).toEqual([1, 2, 3, 4, 5].map((line) => ({ line, message: EFFECT_SCHEMA_FILE_MESSAGE })));
    expect(listEffectViolations('a/schema.ts', 'let a;')).toEqual([]);
    expect(listEffectViolations('a/schema.ts', 'export const Row = Schema.decodeTo(Schema.String);')).toEqual(
      []
    );
    expect(listEffectViolations('a/schema.ts', 'export const Row = Other.decode(Schema.String);')).toEqual(
      []
    );
  });
});
