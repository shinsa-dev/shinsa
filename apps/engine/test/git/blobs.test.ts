import { describe, expect, setDefaultTimeout, test } from 'bun:test';
import { Duration, Effect, Fiber, type Scope } from 'effect';
import { BATCH_IDLE, BATCH_TIMEOUT, type BatchChild, CatFileSettings } from '../../src/git/blobs/schema.ts';
import { CatFiles } from '../../src/git/blobs/service.ts';
import { isBatchName, parseInfoLine } from '../../src/git/tree/entries.ts';
import { createGitRepo, git } from '../helpers/index.ts';

setDefaultTimeout(30_000);

async function createRepo() {
  const repo = await createGitRepo({
    remote: false,
    files: { 'src/a.ts': 'export const a = 1;\n', 'b.txt': 'b' },
  });
  return { ...repo, sha: await git(repo.path, 'rev-parse', 'HEAD') };
}

function createSilentChild(): BatchChild & { written: string[]; finish: () => void } {
  const written: string[] = [];
  let finish = () => {};
  const exited = new Promise<number>((resolve) => {
    finish = () => resolve(0);
  });
  return {
    pid: 999_999_999,
    written,
    finish,
    stdin: { write: (text: string) => written.push(text), flush: () => undefined },
    stdout: new ReadableStream<Uint8Array>({ start: () => {} }),
    exited,
  };
}

function runReaders<A, E>(
  effect: Effect.Effect<A, E, CatFiles | Scope.Scope>,
  settings: { idleMs?: number; timeoutMs?: number; spawn?: (repoPath: string) => BatchChild } = {}
) {
  return Effect.runPromise(
    Effect.scoped(effect).pipe(
      Effect.provide(CatFiles.layer),
      Effect.provideService(CatFileSettings, {
        idle: settings.idleMs === undefined ? BATCH_IDLE : Duration.millis(settings.idleMs),
        timeout: settings.timeoutMs === undefined ? BATCH_TIMEOUT : Duration.millis(settings.timeoutMs),
        spawn: settings.spawn ?? null,
      })
    )
  );
}

describe('parseInfoLine and isBatchName', () => {
  test('read an object line and refuse what git cannot name on one line', () => {
    expect(parseInfoLine(`${'a'.repeat(40)} blob 12`)).toEqual({
      object: 'a'.repeat(40),
      type: 'blob',
      size: 12,
    });
    expect(parseInfoLine('HEAD:missing.ts missing')).toBeNull();
    expect(parseInfoLine(`${'a'.repeat(40)} blob many`)).toBeNull();
    expect(isBatchName('abc:src/a.ts')).toBe(true);
    expect(isBatchName('abc:a\nb')).toBe(false);
    expect(isBatchName('abc:a\0b')).toBe(false);
    expect(isBatchName('')).toBe(false);
  });
});

describe('CatFiles', () => {
  test('answers object lookups and contents in order from one long-lived git', async () => {
    const { path, sha } = await createRepo();
    await runReaders(
      Effect.gen(function* () {
        const reader = yield* (yield* CatFiles).select(path);
        const [file, missing, tree] = yield* Effect.all(
          [reader.info(`${sha}:src/a.ts`), reader.info(`${sha}:nothing.ts`), reader.info(`${sha}:src`)],
          { concurrency: 'unbounded' }
        );
        expect(file).toMatchObject({ type: 'blob', size: 20 });
        expect(missing).toBeNull();
        expect(tree?.type).toBe('tree');
        const [first, second] = yield* Effect.all(
          [reader.contents(file?.object ?? ''), reader.contents(file?.object ?? '')],
          { concurrency: 'unbounded' }
        );
        expect(new TextDecoder().decode(first)).toBe('export const a = 1;\n');
        expect(second).toEqual(first);
        expect(yield* reader.contents('f'.repeat(40))).toEqual(new Uint8Array());
        expect(yield* reader.running).toBe(true);
        yield* Effect.sleep('60 millis');
        expect(yield* reader.running).toBe(false);
        expect((yield* reader.info(`${sha}:b.txt`))?.size).toBe(1);
      }),
      { idleMs: 20 }
    );
  });

  test('stops a git that does not answer in time, and fails what waited on it', async () => {
    const child = createSilentChild();
    await runReaders(
      Effect.gen(function* () {
        const reader = yield* (yield* CatFiles).select('/nowhere');
        const failure = yield* Effect.flip(reader.info('x:y'));
        expect(failure).toMatchObject({ _tag: 'ObjectReaderStopped', message: 'The object reader stopped.' });
        expect(child.written).toEqual(['info x:y\n']);
        expect(yield* reader.running).toBe(false);
      }),
      { timeoutMs: 10, spawn: () => child }
    );
  });

  test('starts again after its git exits', async () => {
    const children: ReturnType<typeof createSilentChild>[] = [];
    await runReaders(
      Effect.gen(function* () {
        const reader = yield* (yield* CatFiles).select('/nowhere');
        const first = yield* Effect.forkChild(Effect.flip(reader.info('x:y')));
        yield* Effect.yieldNow;
        children[0]?.finish();
        expect((yield* Fiber.join(first))._tag).toBe('ObjectReaderStopped');
        const second = yield* Effect.forkChild(Effect.flip(reader.info('x:z')));
        yield* Effect.yieldNow;
        expect(children).toHaveLength(2);
        yield* reader.close;
        expect((yield* Fiber.join(second))._tag).toBe('ObjectReaderStopped');
        children[1]?.finish();
      }),
      {
        spawn: () => {
          const child = createSilentChild();
          children.push(child);
          return child;
        },
      }
    );
  });
});

describe('CatFiles failures', () => {
  test('fails a read when its git cannot start, and starts again on the next one', async () => {
    await runReaders(
      Effect.gen(function* () {
        const reader = yield* (yield* CatFiles).select('/nowhere');
        expect(yield* Effect.flip(reader.info('x:y'))).toMatchObject({ message: 'no git here' });
        expect(yield* reader.running).toBe(false);
        expect(yield* Effect.flip(reader.contents('x'))).toMatchObject({ message: 'no git here' });
      }),
      {
        spawn: () => {
          throw new Error('no git here');
        },
      }
    );
  });

  test('stops when its git output breaks, failing what waited on it', async () => {
    const child = createSilentChild();
    const broken = {
      ...child,
      stdout: new ReadableStream<Uint8Array>({ start: (controller) => controller.error(new Error('pipe')) }),
    };
    await runReaders(
      Effect.gen(function* () {
        const reader = yield* (yield* CatFiles).select('/nowhere');
        expect(yield* Effect.flip(reader.info('x:y'))).toMatchObject({
          message: 'The object reader stopped.',
        });
        expect(yield* reader.running).toBe(false);
      }),
      { timeoutMs: 10, spawn: () => broken }
    );
    child.finish();
  });
});

describe('the pool of readers', () => {
  test('keeps one reader per repository and closes them all when its scope closes', async () => {
    const { path, sha } = await createRepo();
    const reader = await runReaders(
      Effect.gen(function* () {
        const readers = yield* CatFiles;
        const selected = yield* readers.select(path);
        expect(yield* readers.select(path)).toBe(selected);
        expect((yield* selected.info(`${sha}:b.txt`))?.type).toBe('blob');
        expect(yield* selected.running).toBe(true);
        return selected;
      })
    );
    expect(await Effect.runPromise(reader.running)).toBe(false);
  });
});
