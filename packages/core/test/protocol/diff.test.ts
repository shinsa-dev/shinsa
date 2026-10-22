import { describe, expect, test } from 'bun:test';
import { parseUnifiedDiff } from '../../src/index.ts';

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

  test('ignores text that is not a file diff', () => {
    expect(parseUnifiedDiff('')).toEqual([]);
    expect(parseUnifiedDiff('warning: something\n')).toEqual([]);
  });
});
