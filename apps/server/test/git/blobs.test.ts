import { describe, expect, test } from 'bun:test';
import { type BatchChild, CatFile, CatFilePool, isBatchName, parseInfoLine } from '../../src/git/blobs.ts';
import { createGitRepo, git } from '../helpers/index.ts';

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

describe('CatFile', () => {
  test('answers object lookups and contents in order from one long-lived git', async () => {
    const { path, sha } = await createRepo();
    const reader = new CatFile(path, { idleMs: 20 });
    const [file, missing, tree] = await Promise.all([
      reader.info(`${sha}:src/a.ts`),
      reader.info(`${sha}:nothing.ts`),
      reader.info(`${sha}:src`),
    ]);
    expect(file).toMatchObject({ type: 'blob', size: 20 });
    expect(missing).toBeNull();
    expect(tree?.type).toBe('tree');
    const [first, second] = await Promise.all([
      reader.contents(file?.object ?? ''),
      reader.contents(file?.object ?? ''),
    ]);
    expect(new TextDecoder().decode(first)).toBe('export const a = 1;\n');
    expect(second).toEqual(first);
    expect(await reader.contents('f'.repeat(40))).toEqual(new Uint8Array());
    expect(reader.running).toBe(true);
    await Bun.sleep(60);
    expect(reader.running).toBe(false);
    expect((await reader.info(`${sha}:b.txt`))?.size).toBe(1);
    reader.close();
  });

  test('stops a git that does not answer in time, and fails what waited on it', async () => {
    const child = createSilentChild();
    const reader = new CatFile('/nowhere', { timeoutMs: 10, spawn: () => child });
    const pending = reader.info('x:y');
    await expect(pending).rejects.toThrow('The object reader stopped.');
    expect(child.written).toEqual(['info x:y\n']);
    expect(reader.running).toBe(false);
  });

  test('starts again after its git exits', async () => {
    const children: ReturnType<typeof createSilentChild>[] = [];
    const reader = new CatFile('/nowhere', {
      spawn: () => {
        const child = createSilentChild();
        children.push(child);
        return child;
      },
    });
    const first = reader.info('x:y');
    children[0]?.finish();
    await expect(first).rejects.toThrow();
    const second = reader.info('x:z');
    expect(children).toHaveLength(2);
    reader.close();
    await expect(second).rejects.toThrow();
    children[1]?.finish();
  });
});

describe('CatFilePool', () => {
  test('keeps one reader per repository and closes them all', async () => {
    const { path, sha } = await createRepo();
    const pool = new CatFilePool(1000);
    const reader = pool.select(path);
    expect(pool.select(path)).toBe(reader);
    expect((await reader.info(`${sha}:b.txt`))?.type).toBe('blob');
    pool.close();
    expect(reader.running).toBe(false);
    expect(pool.select(path)).not.toBe(reader);
    pool.close();
  });
});
