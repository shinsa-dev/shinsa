import { describe, expect, test } from 'bun:test';
import {
  DIFF_PATCH_LIMITS,
  type DiffFile,
  mergeDiffPatches,
  parseDiffSummary,
  parseUnifiedDiff,
  selectPatchedFiles,
} from '../../src/index.ts';

function file(header: string, body: string) {
  return `${header}\n${body}\n`;
}

const MODIFIED = file(
  'diff --git a/src/view.tsx b/src/view.tsx\nindex 1..2 100644\n--- a/src/view.tsx\n+++ b/src/view.tsx',
  '@@ -1,3 +1,3 @@\n context\n-old\n+new\n+added'
);

describe('parseUnifiedDiff', () => {
  test('counts the added and removed lines of each file, never its headers', () => {
    const [view] = parseUnifiedDiff(MODIFIED);
    expect(view).toMatchObject({
      path: 'src/view.tsx',
      previousPath: null,
      status: 'modified',
      additions: 2,
      deletions: 1,
    });
    expect(view?.patch).toBe(MODIFIED);
  });

  test('a removed line that starts with dashes is still a deletion', () => {
    const sql = file(
      'diff --git a/db/query.sql b/db/query.sql\n--- a/db/query.sql\n+++ b/db/query.sql',
      '@@ -1,2 +1,1 @@\n--- a comment\n+++ a counter\n select 1;'
    );
    expect(parseUnifiedDiff(sql)[0]).toMatchObject({ additions: 1, deletions: 1 });
  });

  test('reads added, removed and renamed files', () => {
    const diff = [
      file('diff --git a/src/new.ts b/src/new.ts\nnew file mode 100644', '@@ -0,0 +1 @@\n+export {};'),
      file('diff --git a/src/old.ts b/src/old.ts\ndeleted file mode 100644', '@@ -1 +0,0 @@\n-export {};'),
      file(
        'diff --git a/src/a.ts b/src/b.ts\nsimilarity index 100%\nrename from src/a.ts\nrename to src/b.ts',
        ''
      ),
    ].join('');
    const byPath = Object.fromEntries(parseUnifiedDiff(diff).map((entry) => [entry.path, entry]));
    expect(byPath['src/new.ts']?.status).toBe('added');
    expect(byPath['src/old.ts']?.status).toBe('removed');
    expect(byPath['src/b.ts']).toMatchObject({ status: 'renamed', previousPath: 'src/a.ts' });
  });

  test('puts risky files first, then the biggest changes, then by path', () => {
    const diff = [
      file('diff --git a/README.md b/README.md', '@@ -1 +1 @@\n-a\n+b'),
      file('diff --git a/src/z.ts b/src/z.ts', '@@ -1 +1,2 @@\n-a\n+b\n+c'),
      file('diff --git a/src/a.ts b/src/a.ts', '@@ -1 +1,2 @@\n-a\n+b\n+c'),
      file('diff --git a/src/small.ts b/src/small.ts', '@@ -1 +1 @@\n-a\n+b'),
      file('diff --git a/src/auth/session.ts b/src/auth/session.ts', '@@ -1 +1 @@\n-a\n+b'),
    ].join('');
    const files = parseUnifiedDiff(diff);
    expect(files.map((entry) => entry.path)).toEqual([
      'src/auth/session.ts',
      'src/a.ts',
      'src/z.ts',
      'src/small.ts',
      'README.md',
    ]);
    expect(files[0]).toMatchObject({ risk: 'high', riskReason: 'Touches auth or security' });
    expect(files.at(-1)).toMatchObject({ risk: 'low', riskReason: null });
  });

  test('names why a file is risky', () => {
    const reasons = [
      'drizzle/0001_migration.sql',
      'src/billing/charge.ts',
      'apps/api/routes/users.ts',
      '.github/workflows/test.yml',
      'package.json',
    ].map((path) => parseUnifiedDiff(file(`diff --git a/${path} b/${path}`, ''))[0]?.riskReason);
    expect(reasons).toEqual([
      'Changes the data model',
      'Touches money',
      'Changes a server surface',
      'Changes deploy or CI',
      'Changes dependencies or configuration',
    ]);
  });

  test('marks a binary file, which has no lines to count', () => {
    const png = file(
      'diff --git a/logo.png b/logo.png\nindex 1..2 100644',
      'Binary files a/logo.png and b/logo.png differ'
    );
    const patched = file(
      'diff --git a/icon.ico b/icon.ico\nindex 1..2 100644',
      'GIT binary patch\nliteral 4'
    );
    expect(parseUnifiedDiff(png)[0]).toMatchObject({ binary: true, additions: 0, deletions: 0 });
    expect(parseUnifiedDiff(patched)[0]?.binary).toBe(true);
    expect(parseUnifiedDiff(MODIFIED)[0]?.binary).toBe(false);
  });

  test('ignores text that is not a file diff', () => {
    expect(parseUnifiedDiff('')).toEqual([]);
    expect(parseUnifiedDiff('warning: something\n')).toEqual([]);
  });
});

describe('parseDiffSummary', () => {
  const raw = [
    ':100644 100644 aaa bbb M',
    'src/app.ts',
    ':000000 100644 000 ccc A',
    'docs/new.md',
    ':100644 000000 ddd 000 D',
    'src/auth/gone.ts',
    ':100644 100644 eee fff R087',
    'src/old.ts',
    'src/renamed.ts',
    ':100644 100644 eee fff C075',
    'src/source.ts',
    'src/copy.ts',
    ':100644 100644 111 222 M',
    'logo.png',
    '10\t2\tsrc/app.ts',
    '3\t0\tdocs/new.md',
    '0\t7\tsrc/auth/gone.ts',
    '4\t1\t',
    'src/old.ts',
    'src/renamed.ts',
    '9\t0\t',
    'src/source.ts',
    'src/copy.ts',
    '-\t-\tlogo.png',
    '',
  ].join('\0');

  test('reads statuses, paths, counts and binaries from a raw and numstat listing, with no patches yet', () => {
    const files = parseDiffSummary(raw);
    expect(
      files.map((entry) => [entry.path, entry.status, entry.previousPath, entry.additions, entry.deletions])
    ).toEqual([
      ['src/auth/gone.ts', 'removed', null, 0, 7],
      ['src/app.ts', 'modified', null, 10, 2],
      ['src/copy.ts', 'added', null, 9, 0],
      ['src/renamed.ts', 'renamed', 'src/old.ts', 4, 1],
      ['logo.png', 'modified', null, 0, 0],
      ['docs/new.md', 'added', null, 3, 0],
    ]);
    expect(files.find((entry) => entry.path === 'logo.png')?.binary).toBe(true);
    expect(files.every((entry) => entry.patch === '' && entry.patchOmitted)).toBe(true);
    expect(files[0]?.risk).toBe('high');
  });

  test('reads an empty listing as no files, and a raw record with no counts as nothing changed', () => {
    expect(parseDiffSummary('')).toEqual([]);
    const [only] = parseDiffSummary(':100644 100644 a b M\0x.ts\0');
    expect(only).toMatchObject({ path: 'x.ts', additions: 0, deletions: 0, binary: false });
  });
});

describe('patch budget', () => {
  function summaryFile(path: string, lines: number, binary = false) {
    return {
      ...parseDiffSummary(`:100644 100644 a b M\0${path}\0${lines}\t0\t${path}\0`)[0],
      binary,
    } as DiffFile;
  }

  test('picks files in order until the total runs out, skipping binaries and files too long to patch', () => {
    const full = Array.from({ length: 9 }, (_, index) =>
      summaryFile(`full${index}.ts`, DIFF_PATCH_LIMITS.fileLines)
    );
    const chosen = selectPatchedFiles([
      summaryFile('a.ts', 10),
      summaryFile('b.png', 0, true),
      summaryFile('huge.ts', DIFF_PATCH_LIMITS.fileLines + 1),
      ...full,
      summaryFile('over.ts', DIFF_PATCH_LIMITS.fileLines - 9),
      summaryFile('late.ts', 1),
    ]);
    expect(chosen.map((item) => item.path)).toEqual(['a.ts', ...full.map((item) => item.path)]);
    const many = Array.from({ length: DIFF_PATCH_LIMITS.files + 5 }, (_, index) =>
      summaryFile(`f${index}.ts`, 1)
    );
    expect(selectPatchedFiles(many)).toHaveLength(DIFF_PATCH_LIMITS.files);
  });

  test('fills the patches it read and marks the rest as omitted, binaries as having nothing to read', () => {
    const summary = [summaryFile('a.ts', 1), summaryFile('b.ts', 1), summaryFile('c.png', 0, true)];
    const merged = mergeDiffPatches(summary, [{ ...summaryFile('a.ts', 1), patch: '@@ -1 +1 @@\n+x\n' }]);
    expect(merged.map((item) => [item.path, item.patch, item.patchOmitted])).toEqual([
      ['a.ts', '@@ -1 +1 @@\n+x\n', false],
      ['b.ts', '', true],
      ['c.png', '', false],
    ]);
  });

  test('leaves out a patch too large on its own, and any once the total is spent', () => {
    const summary = [summaryFile('long-line.js', 1), summaryFile('a.ts', 1), summaryFile('b.ts', 1)];
    const patched = [
      { ...summaryFile('long-line.js', 1), patch: 'x'.repeat(50) },
      { ...summaryFile('a.ts', 1), patch: 'y'.repeat(20) },
      { ...summaryFile('b.ts', 1), patch: 'z'.repeat(20) },
    ];
    const merged = mergeDiffPatches(summary, patched, { fileBytes: 40, totalBytes: 30 });
    expect(merged.map((item) => item.patchOmitted)).toEqual([true, false, true]);
  });
});
