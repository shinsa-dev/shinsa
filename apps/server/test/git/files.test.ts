import { describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CODE_LIMITS, WORKING_REF } from '@shinsa/core';
import {
  assertCommit,
  listCommitPaths,
  listCommitTree,
  listWorkingPaths,
  listWorkingTree,
  readCommitBytes,
  readCommitFile,
  readWorkingBytes,
  readWorkingFile,
  searchFiles,
} from '../../src/git/files.ts';
import { ObjectCache } from '../../src/git/objects.ts';
import { createGitRepo, git, writeFiles } from '../helpers/index.ts';

const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]);

async function createSampleRepo() {
  const sample = await createGitRepo({
    remote: false,
    files: {
      'src/app.ts': 'export const greeting = "hello";\nexport const other = "Hello";\n',
      'src/lib/util.ts': 'export function hello() {}\n',
      'docs/guide.md': '# Guide\nSay hello.\n',
      'big.txt': 'x'.repeat(CODE_LIMITS.blobBytes + 1),
    },
  });
  writeFileSync(join(sample.path, 'logo.png'), PNG);
  symlinkSync('src/app.ts', join(sample.path, 'link.ts'));
  await git(sample.path, 'add', '-A');
  await git(sample.path, 'commit', '-q', '-m', 'feat: sample');
  return { ...sample, sha: await git(sample.path, 'rev-parse', 'HEAD') };
}

describe('assertCommit', () => {
  test('accepts a commit of this repository and nothing else', async () => {
    const { path, sha } = await createSampleRepo();
    expect(await assertCommit(path, sha)).toBe(sha);
    await expect(assertCommit(path, 'main')).rejects.toMatchObject({ code: 'ref_invalid' });
    await expect(assertCommit(path, '--output=/tmp/x')).rejects.toMatchObject({ code: 'ref_invalid' });
    await expect(assertCommit(path, 'a'.repeat(40))).rejects.toMatchObject({ code: 'ref_unknown' });
    const tree = await git(path, 'rev-parse', 'HEAD^{tree}');
    await expect(assertCommit(path, tree)).rejects.toMatchObject({ code: 'ref_unknown' });
  });
});

describe('listing files', () => {
  test('lists every path at a commit, with what each entry is', async () => {
    const { path, sha } = await createSampleRepo();
    expect((await listCommitPaths(path, sha)).paths).toEqual([
      'README.md',
      'big.txt',
      'docs/guide.md',
      'link.ts',
      'logo.png',
      'src/app.ts',
      'src/lib/util.ts',
    ]);
    const root = await listCommitTree(path, sha, '');
    expect(root.entries.map((entry) => [entry.name, entry.kind])).toEqual([
      ['docs', 'directory'],
      ['src', 'directory'],
      ['big.txt', 'file'],
      ['link.ts', 'symlink'],
      ['logo.png', 'file'],
      ['README.md', 'file'],
    ]);
    expect(root.entries.find((entry) => entry.name === 'logo.png')?.size).toBe(PNG.length);
    const src = await listCommitTree(path, sha, 'src');
    expect(src.entries.map((entry) => entry.path)).toEqual(['src/lib', 'src/app.ts']);
    expect((await listCommitTree(path, sha, 'missing')).entries).toEqual([]);
  });

  test('the working copy lists untracked files and leaves out deleted and ignored ones', async () => {
    const { path } = await createSampleRepo();
    writeFiles(path, { '.gitignore': 'dist/\n', 'dist/out.js': '', 'src/new.ts': '' });
    rmSync(join(path, 'docs/guide.md'));
    const paths = await listWorkingPaths(path);
    expect(paths.ref).toBe(WORKING_REF);
    expect(paths.paths).toContain('src/new.ts');
    expect(paths.paths).not.toContain('docs/guide.md');
    expect(paths.paths).not.toContain('dist/out.js');
    expect(listWorkingTree(paths, 'src').entries.map((entry) => [entry.name, entry.kind])).toEqual([
      ['lib', 'directory'],
      ['app.ts', 'file'],
      ['new.ts', 'file'],
    ]);
    expect(listWorkingTree(paths, '').entries.map((entry) => entry.name)).toContain('.gitignore');
  });

  test('a read that git refuses becomes a refusal with the reason', async () => {
    const { path } = await createSampleRepo();
    await expect(listCommitPaths(path, 'b'.repeat(40))).rejects.toMatchObject({ code: 'read_failed' });
  });
});

describe('reading a file', () => {
  test('reads text, marks binary images and refuses what is too large', async () => {
    const { path, sha } = await createSampleRepo();
    const cache = new ObjectCache();
    expect(await readCommitFile(path, sha, 'src/app.ts', cache)).toMatchObject({
      ref: sha,
      content: 'export const greeting = "hello";\nexport const other = "Hello";\n',
      binary: false,
      missing: false,
    });
    expect(cache.size).toBe(1);
    await readCommitFile(path, sha, 'src/app.ts', cache);
    expect(cache.size).toBe(1);
    expect(await readCommitFile(path, sha, 'logo.png', cache)).toMatchObject({
      content: null,
      binary: true,
      image: 'image/png',
      size: PNG.length,
    });
    expect(await readCommitFile(path, sha, 'big.txt', cache)).toMatchObject({
      tooLarge: true,
      missing: false,
      content: null,
    });
    expect(await readCommitFile(path, sha, 'link.ts', cache)).toMatchObject({ content: 'src/app.ts' });
    expect(await readCommitFile(path, sha, 'src', cache)).toMatchObject({ missing: true });
    expect(await readCommitFile(path, sha, 'nope.ts', cache)).toMatchObject({ missing: true });
    expect(await readCommitBytes(path, sha, 'logo.png')).toEqual(PNG);
    expect(await readCommitBytes(path, sha, 'big.txt')).toBeNull();
  });

  test('reads the working copy as it is on disk', async () => {
    const { path } = await createSampleRepo();
    writeFiles(path, { 'src/app.ts': 'changed\n' });
    mkdirSync(join(path, 'empty'));
    expect(readWorkingFile(join(path, 'src/app.ts'), 'src/app.ts')).toMatchObject({
      ref: WORKING_REF,
      content: 'changed\n',
    });
    expect(readWorkingFile(join(path, 'link.ts'), 'link.ts')).toMatchObject({ content: 'src/app.ts' });
    expect(readWorkingFile(join(path, 'big.txt'), 'big.txt')).toMatchObject({ tooLarge: true });
    expect(readWorkingFile(join(path, 'empty'), 'empty')).toMatchObject({ missing: true });
    expect(readWorkingFile(join(path, 'gone.ts'), 'gone.ts')).toMatchObject({ missing: true });
    expect(readWorkingBytes(join(path, 'logo.png'))).toEqual(PNG);
    expect(readWorkingBytes(join(path, 'big.txt'))).toBeNull();
    expect(readWorkingBytes(join(path, 'gone.png'))).toBeNull();
  });
});

describe('searchFiles', () => {
  test('finds text at a commit, ignoring case unless asked', async () => {
    const { path, sha } = await createSampleRepo();
    const search = { query: 'hello', regex: false, caseSensitive: false, glob: null };
    const loose = await searchFiles(path, sha, search);
    expect(loose.ref).toBe(sha);
    expect(loose.matches.map((match) => `${match.path}:${match.line}:${match.column}`)).toEqual([
      'docs/guide.md:2:5',
      'src/app.ts:1:26',
      'src/app.ts:2:23',
      'src/lib/util.ts:1:17',
    ]);
    const strict = await searchFiles(path, sha, { ...search, query: 'Hello', caseSensitive: true });
    expect(strict.matches.map((match) => match.text)).toEqual(['export const other = "Hello";']);
  });

  test('takes a regular expression and limits the files by a pattern', async () => {
    const { path, sha } = await createSampleRepo();
    const regex = await searchFiles(path, sha, {
      query: 'hel+o\\(',
      regex: true,
      caseSensitive: true,
      glob: null,
    });
    expect(regex.matches.map((match) => match.path)).toEqual(['src/lib/util.ts']);
    const literal = await searchFiles(path, sha, {
      query: 'hel+o',
      regex: false,
      caseSensitive: false,
      glob: null,
    });
    expect(literal.matches).toEqual([]);
    const typed = await searchFiles(path, sha, {
      query: 'hello',
      regex: false,
      caseSensitive: false,
      glob: '*.md',
    });
    expect(typed.matches.map((match) => match.path)).toEqual(['docs/guide.md']);
    const nested = await searchFiles(path, sha, {
      query: 'hello',
      regex: false,
      caseSensitive: false,
      glob: 'src/lib/*',
    });
    expect(nested.matches.map((match) => match.path)).toEqual(['src/lib/util.ts']);
  });

  test('searches the working copy, untracked files included', async () => {
    const { path } = await createSampleRepo();
    writeFiles(path, { 'notes.txt': 'hello from the agent\n' });
    const found = await searchFiles(path, null, {
      query: 'from the agent',
      regex: false,
      caseSensitive: true,
      glob: null,
    });
    expect(found).toMatchObject({ ref: WORKING_REF, truncated: false, timedOut: false });
    expect(found.matches.map((match) => match.path)).toEqual(['notes.txt']);
  });

  test('stops at the match limit and says so', async () => {
    const { path } = await createGitRepo({
      remote: false,
      files: { 'many.txt': 'needle\n'.repeat(CODE_LIMITS.matches + 5) },
    });
    const sha = await git(path, 'rev-parse', 'HEAD');
    const found = await searchFiles(path, sha, {
      query: 'needle',
      regex: false,
      caseSensitive: true,
      glob: null,
    });
    expect(found.matches).toHaveLength(CODE_LIMITS.matches);
    expect(found.truncated).toBe(true);
  });

  test('a pattern git cannot read is a refusal', async () => {
    const { path, sha } = await createSampleRepo();
    await expect(
      searchFiles(path, sha, { query: '(', regex: true, caseSensitive: true, glob: null })
    ).rejects.toMatchObject({ code: 'read_failed' });
  });
});
