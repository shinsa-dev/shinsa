import { describe, expect, test } from 'bun:test';
import { RAW_IO_BASELINE } from './lint-effect-baseline.ts';
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
  isPromiseIoSource,
  listEffectViolations,
  listPromiseLines,
  isEngineRuntimeSource,
  isSyncIoSource,
  isEffectIoSource,
  listUnbridgedIoLines,
  listEngineRuntimeLines,
  listSyncIoLines,
  listRawIoViolations,
  listStaleBaselineFiles,
  RAW_IO_BASELINE_MESSAGE,
  RAW_IO_MESSAGE,
  SYNC_IO_EXEMPT,
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

describe('every workspace does its I/O in Effect', () => {
  test('every .ts source file and script without an effect import is checked, never tests or components', () => {
    const plain = 'export class Teams {}';
    expect(isPromiseIoSource('apps/engine/src/remote/teams.ts', plain)).toBe(true);
    expect(isPromiseIoSource('apps/web/src/lib/api.ts', plain)).toBe(true);
    expect(isPromiseIoSource('packages/core/src/remote/keys.ts', plain)).toBe(true);
    expect(isPromiseIoSource('scripts/release.ts', plain)).toBe(true);
    expect(isPromiseIoSource('apps/desktop/scripts/build.ts', plain)).toBe(true);
    expect(isPromiseIoSource('apps/engine/scripts/build-engine.ts', plain)).toBe(true);
    expect(isPromiseIoSource('packages/ui/scripts/icons.ts', plain)).toBe(true);
    expect(isPromiseIoSource('apps/engine/src/remote/teams.ts', "import { Effect } from 'effect';")).toBe(
      false
    );
    expect(isPromiseIoSource('apps/web/src/components/task/row.tsx', plain)).toBe(false);
    expect(isPromiseIoSource('apps/engine/src/remote/teams.test.ts', plain)).toBe(false);
    expect(isPromiseIoSource('apps/engine/test/remote/teams.ts', plain)).toBe(false);
    expect(isPromiseIoSource('scripts/lint-effect.test.ts', plain)).toBe(false);
    expect(isPromiseIoSource('docs/notes.ts', plain)).toBe(false);
  });

  test('every await, async function, new Promise and promise chain is found, with its line', () => {
    const source = [
      'export async function join() {',
      '  await request();',
      '}',
      'const later = new Promise(() => {});',
      'run().then(done);',
      'Effect.catch(run, stop);',
      'const plain = () => 1;',
    ].join('\n');
    expect(listPromiseLines('apps/engine/src/a.ts', source)).toEqual([1, 2, 4, 5]);
    expect(listPromiseLines('apps/engine/src/a.tsx', 'const v = () => <Row />;')).toEqual([]);
  });
});

describe('the engine runs effects only at its edge', () => {
  test('every engine source file but main.ts is checked, effect imports included, never tests', () => {
    expect(isEngineRuntimeSource('apps/engine/src/remote/teams.ts')).toBe(true);
    expect(isEngineRuntimeSource('apps/engine/src/main.ts')).toBe(false);
    expect(isEngineRuntimeSource('apps/engine/src/remote/teams.test.ts')).toBe(false);
    expect(isEngineRuntimeSource('apps/engine/test/harness.ts')).toBe(false);
    expect(isEngineRuntimeSource('apps/web/src/lib/api.ts')).toBe(false);
  });

  test('a runtime, a run call and a class that is not a service are found, with their lines', () => {
    const source = [
      "import { Effect, ManagedRuntime } from 'effect';",
      'export class Teams {',
      '  create = () => edgeRuntime.runPromise(make);',
      '}',
      'Effect.runSync(step);',
      'runtime.runFork(step);',
      'export class Clock extends StateClock {}',
      'Effect.runForkWith(context)(step);',
      "export class Teams2 extends Context.Service<Teams2, Shape>()('shinsa/engine/Teams') {}",
      "export class Gone extends Schema.TaggedError<Gone>()('Gone', {}) {}",
      'export class Broken extends Error {}',
      'class Local {}',
      'export class Odd extends (class {}) {}',
    ].join('\n');
    expect(listEngineRuntimeLines('apps/engine/src/a.ts', source)).toEqual([1, 2, 3, 5, 6, 7, 13]);
  });
});

describe('no file or process I/O runs outside Effect', () => {
  test('the Promise I/O files are checked, and the one synchronous transcript reader is exempt', () => {
    const plain = 'export const a = 1;';
    expect(isSyncIoSource('apps/engine/src/files/probe.ts', plain)).toBe(true);
    expect(isSyncIoSource('apps/desktop/scripts/icon.ts', plain)).toBe(true);
    expect(isSyncIoSource('scripts/seed.ts', plain)).toBe(true);
    expect(isSyncIoSource('apps/engine/src/files/probe.ts', "import { Effect } from 'effect';")).toBe(false);
    expect(isSyncIoSource('apps/engine/test/files/probe.test.ts', plain)).toBe(false);
    expect(isSyncIoSource('apps/web/src/components/row.tsx', plain)).toBe(false);
    expect(isSyncIoSource('packages/ui/scripts/icons.ts', plain)).toBe(true);
    for (const file of SYNC_IO_EXEMPT) expect(isSyncIoSource(file, plain)).toBe(false);
  });

  test('fs and child_process value imports and Bun process and file calls are found, with their lines', () => {
    const source = [
      "import { existsSync } from 'node:fs';",
      "import { readFile } from 'fs/promises';",
      "import { spawnSync } from 'node:child_process';",
      "import type { Stats } from 'node:fs';",
      "import { type Dirent } from 'node:fs';",
      "import { join } from 'node:path';",
      "const found = Bun.which('git');",
      'Bun.spawnSync(["ls"]); Bun.spawn(["ls"]);',
      "const text = Bun.file('a').text;",
      "Bun.write('a', 'b');",
      'const run = Bun.build;',
      'const id = Bun.randomUUIDv7();',
      'const env = Bun.env.HOME;',
    ].join('\n');
    expect(listSyncIoLines(source)).toEqual([1, 2, 3, 7, 8, 9, 10, 11]);
  });

  test('a file with no I/O has nothing to report', () => {
    expect(listSyncIoLines("import { join } from 'node:path';\nexport const a = join('x', 'y');")).toEqual(
      []
    );
  });

  test('Effect files are checked too, but not tests, components or the exempt transcript reader', () => {
    const effect = "import { Effect } from 'effect';";
    expect(isEffectIoSource('apps/engine/src/changelog/changelog.ts', effect)).toBe(true);
    expect(isEffectIoSource('scripts/zz.ts', "import { Option } from 'effect';")).toBe(true);
    expect(isEffectIoSource('apps/desktop/scripts/build.ts', effect)).toBe(true);
    expect(isEffectIoSource('scripts/zz.ts', 'export const a = 1;')).toBe(false);
    expect(isEffectIoSource('apps/engine/test/a.test.ts', effect)).toBe(false);
    expect(isEffectIoSource('apps/web/src/components/row.tsx', effect)).toBe(false);
    for (const file of SYNC_IO_EXEMPT) expect(isEffectIoSource(file, effect)).toBe(false);
  });

  test('in an Effect file, I/O outside an effect is found and I/O inside one is not', () => {
    const source = [
      "import { readFileSync, existsSync } from 'node:fs';",
      "import * as fs from 'node:fs';",
      "import type { Stats } from 'node:fs';",
      "import { Effect } from 'effect';",
      "export function plain() { return readFileSync('a', 'utf8'); }",
      'const helper = (path: string) => existsSync(path);',
      "const read = Effect.try(() => readFileSync('a', 'utf8'));",
      "const tried = Effect.try({ try: () => fs.statSync('a'), catch: String });",
      "const quiet = Effect.sync(() => existsSync('a'));",
      'const attempt = <A>(run: () => A) => Effect.try({ try: run, catch: String });',
      'const probe = (run: () => boolean) => Effect.try(run);',
      "const viaHelper = attempt(() => readFileSync('a'));",
      "const viaShort = probe(() => existsSync('a'));",
      "export const found = Effect.fn('found')(function* () { return Bun.which('git'); });",
      "const lazy = Effect.sync(() => Bun.file('a'));",
      "const direct = fs.readdirSync('.');",
      'const other = (run: () => void) => Effect.succeed(run);',
      "const notHelper = other(() => existsSync('a'));",
      'const id = Bun.randomUUIDv7();',
    ].join('\n');
    expect(listUnbridgedIoLines(source)).toEqual([5, 6, 14, 16, 18]);
  });
});

describe('raw file and process I/O in Effect code only shrinks', () => {
  const raw = [
    "import { readFileSync } from 'node:fs';",
    "import { Effect } from 'effect';",
    "export const read = Effect.try({ try: () => readFileSync('a'), catch: () => 'no' });",
    "export const which = Effect.sync(() => Bun.which('git'));",
  ].join('\n');
  const clean = "import { Effect, FileSystem } from 'effect';\nexport const fs = FileSystem.FileSystem;";
  const [listed = ''] = RAW_IO_BASELINE;

  test('a new Effect file that imports node:fs or calls Bun I/O fails, even inside Effect.try', () => {
    expect(listRawIoViolations('apps/engine/src/new.ts', raw)).toEqual([
      { line: 1, message: RAW_IO_MESSAGE },
      { line: 4, message: RAW_IO_MESSAGE },
    ]);
    expect(listRawIoViolations('apps/engine/src/new.ts', clean)).toEqual([]);
    expect(listRawIoViolations('apps/engine/test/new.test.ts', raw)).toEqual([]);
    expect(
      listRawIoViolations('apps/engine/src/new.ts', `import type { Stats } from 'node:fs';\n${clean}`)
    ).toEqual([]);
  });

  test('a listed file may keep its raw I/O until it moves, then must leave the list', () => {
    expect(listed).not.toBe('');
    expect(listRawIoViolations(listed, raw)).toEqual([]);
    expect(listRawIoViolations(listed, clean)).toEqual([{ line: 1, message: RAW_IO_BASELINE_MESSAGE }]);
    expect(listRawIoViolations(listed, 'export const a = 1;')).toEqual([
      { line: 1, message: RAW_IO_BASELINE_MESSAGE },
    ]);
  });

  test('a listed file the lint never reached, because it moved or was deleted, is stale', () => {
    expect(listStaleBaselineFiles(new Set(RAW_IO_BASELINE))).toEqual([]);
    expect(listStaleBaselineFiles(new Set([...RAW_IO_BASELINE].filter((file) => file !== listed)))).toEqual([
      listed,
    ]);
  });
});
