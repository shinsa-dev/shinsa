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
  RAW_IO_MESSAGE,
  SYNC_IO_EXEMPT,
  isBaselineSource,
  listBaselineRuleViolations,
  NULL_RETURN_MESSAGE,
  PLAIN_JSON_MESSAGE,
  PLAIN_THROW_MESSAGE,
  PLAIN_TRY_MESSAGE,
  TIMER_MESSAGE,
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

  test('a core file that only uses Option, Result or Schema is pure code, one that imports Effect is not', () => {
    const pure = "import { Option, Result, Schema } from 'effect';";
    expect(isEffectSource('packages/core/src/state/queries.ts', pure)).toBe(false);
    expect(isPromiseIoSource('packages/core/src/state/queries.ts', pure)).toBe(true);
    expect(
      isEffectSource('packages/core/src/remote/keys.ts', "import { Effect, Option } from 'effect';")
    ).toBe(true);
    expect(isEffectSource('apps/web/src/lib/a.ts', pure)).toBe(true);
    expect(
      listBaselineRuleViolations(
        'packages/core/src/state/queries.ts',
        `${pure}\nthrow new DomainError({ code: 'a', message: 'A.' });\nJSON.parse(t);`
      ).map(({ rule, line }) => `${rule}:${line}`)
    ).toEqual(['json-parse:3']);
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

describe('raw file and process I/O in Effect code', () => {
  const raw = [
    "import { readFileSync } from 'node:fs';",
    "import { Effect } from 'effect';",
    "export const read = Effect.try({ try: () => readFileSync('a'), catch: () => 'no' });",
    "export const which = Effect.sync(() => Bun.which('git'));",
  ].join('\n');
  const clean = "import { Effect, FileSystem } from 'effect';\nexport const fs = FileSystem.FileSystem;";

  test('fails in every Effect source file, even inside Effect.try, and a type import or a test is fine', () => {
    expect(listRawIoViolations('apps/engine/src/new.ts', raw)).toEqual([
      { line: 1, message: RAW_IO_MESSAGE },
      { line: 4, message: RAW_IO_MESSAGE },
    ]);
    expect(listRawIoViolations('scripts/release/new.ts', raw)).toHaveLength(2);
    expect(listRawIoViolations('apps/engine/src/new.ts', clean)).toEqual([]);
    expect(listRawIoViolations('apps/engine/test/new.test.ts', raw)).toEqual([]);
    expect(
      listRawIoViolations('apps/engine/src/new.ts', `import type { Stats } from 'node:fs';\n${clean}`)
    ).toEqual([]);
  });
});

describe('the baseline rules', () => {
  const rules = (file: string, source: string) =>
    listBaselineRuleViolations(file, source).map(({ rule, line }) => `${rule}:${line}`);

  test('every source file and script is checked, never a test, a declaration file or a doc', () => {
    expect(isBaselineSource('packages/core/src/costs/index.ts')).toBe(true);
    expect(isBaselineSource('apps/web/src/components/task/row.tsx')).toBe(true);
    expect(isBaselineSource('scripts/seed/tasks/index.ts')).toBe(true);
    expect(isBaselineSource('apps/desktop/scripts/build.ts')).toBe(true);
    expect(isBaselineSource('apps/engine/test/harness.ts')).toBe(false);
    expect(isBaselineSource('scripts/lint-effect.test.ts')).toBe(false);
    expect(isBaselineSource('apps/web/src/env.d.ts')).toBe(false);
    expect(isBaselineSource('docs/notes.ts')).toBe(false);
    expect(listBaselineRuleViolations('apps/engine/test/a.ts', 'throw x;')).toEqual([]);
  });

  test('a throw and a try/catch outside Effect are found in plain .ts files, with their messages', () => {
    expect(
      listBaselineRuleViolations(
        'apps/web/src/lib/a.ts',
        'const a = 1;\nthrow new Error("no");\ntry { a(); } catch {}'
      )
    ).toEqual([
      { rule: 'throw', line: 2, message: PLAIN_THROW_MESSAGE },
      { rule: 'try-catch', line: 3, message: PLAIN_TRY_MESSAGE },
    ]);
  });

  test('a DomainError refusal thrown in core passes, any other throw there or one outside core fails', () => {
    const refusal = "throw new DomainError({ code: 'no', message: 'No.' });";
    expect(rules('packages/core/src/decide/tasks.ts', refusal)).toEqual([]);
    expect(rules('packages/core/src/decide/tasks.ts', 'throw refusal;\nthrow new Error("no");')).toEqual([
      'throw:1',
      'throw:2',
    ]);
    expect(rules('apps/engine/src/terminals/input.ts', refusal)).toEqual(['throw:1']);
  });

  test('Effect files and components are left to their own rules for a throw and a try/catch', () => {
    const effect = "import { Effect } from 'effect';\nthrow x;\ntry { a(); } catch {}\nJSON.parse(t);";
    expect(rules('apps/engine/src/a.ts', effect)).toEqual([]);
    expect(rules('apps/web/src/components/row.tsx', 'throw x;\ntry { a(); } catch {}')).toEqual([]);
  });

  test('JSON.parse is found in plain files and components, never twice in Effect files', () => {
    expect(listBaselineRuleViolations('scripts/perf/a.ts', 'const v = JSON.parse(text);')).toEqual([
      { rule: 'json-parse', line: 1, message: PLAIN_JSON_MESSAGE },
    ]);
    expect(rules('apps/web/src/components/row.tsx', 'const v = () => <A v={JSON.parse(t)} />;')).toEqual([
      'json-parse:1',
    ]);
    expect(rules('apps/web/src/lib/a.ts', 'const t = JSON.stringify(v);')).toEqual([]);
  });

  test('timers are found everywhere, Effect files included, unless Effect.callback owns them', () => {
    const source = [
      "import { Effect } from 'effect';",
      'setTimeout(run, 10);',
      'window.setInterval(run, 10);',
      'globalThis.setTimeout(run);',
      'Effect.callback((resume) => { const id = setTimeout(resume, 10); return Effect.sync(() => clearTimeout(id)); });',
      'Effect.sync(() => setTimeout(run));',
      'clearTimeout(id);',
    ].join('\n');
    expect(listBaselineRuleViolations('apps/engine/src/a.ts', source)).toEqual(
      [2, 3, 4, 6].map((line) => ({ rule: 'timer', line, message: TIMER_MESSAGE }))
    );
    expect(
      rules('apps/web/src/components/row.tsx', 'const v = () => <A on={() => setTimeout(a)} />;')
    ).toEqual(['timer:1']);
    expect(rules('apps/web/src/lib/a.ts', 'const timer = setTimeout;\nrun()();')).toEqual([]);
  });

  test('an exported core function that returns null is found once, on its first line', () => {
    const source = [
      'export function a() { return null; }',
      'export function b(): string | null { return x; }',
      'export const c = () => null;',
      'export const d = (v) => (v ? v : null);',
      'export const e = function () { return v ?? null; };',
      'export function f() { if (x) return null; return null; }',
      'export const g = () => (null as unknown as string);',
      'export default function h() { return null; }',
      'export function ok() { const inner = () => null; return inner; }',
      'export const k = (v) => v || 1;',
      'function local() { return null; }',
      'export const value = null;',
      'export { local };',
      'export const l = (v) => v satisfies string;',
      'export default value;',
      'export function m() { return; }',
      'export class N { run() { return null; } }',
      'export const o = 1, p = () => null;',
    ].join('\n');
    expect(listBaselineRuleViolations('packages/core/src/a.ts', source)).toEqual(
      [1, 2, 3, 4, 5, 6, 7, 8, 18].map((line) => ({
        rule: 'null-return',
        line,
        message: NULL_RETURN_MESSAGE,
      }))
    );
  });

  test('a null inside the return type is not a null return, only null in its top-level union', () => {
    const source = [
      'export function a(): Validation<{ live: boolean | null }> { return v; }',
      'export function b(): Map<string, Rate | null> { return m; }',
      'export const c = (): readonly (string | null)[] => list;',
      'export function d(): (string | null) { return x; }',
      'export function e(): Option<string> | (number | null) { return x; }',
    ].join('\n');
    expect(rules('packages/core/src/a.ts', source)).toEqual(['null-return:4', 'null-return:5']);
  });

  test('null returns are only checked in core, never in other packages or components', () => {
    const source = 'export function a() { return null; }';
    expect(rules('apps/engine/src/a.ts', source)).toEqual([]);
    expect(rules('packages/core/src/a.tsx', source)).toEqual([]);
    expect(rules('packages/core/test/a.ts', source)).toEqual([]);
  });
});
