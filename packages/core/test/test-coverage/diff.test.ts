import { describe, expect, test } from 'bun:test';
import { parseChangedLines } from '../../src/test-coverage/diff.ts';

function serialize(diff: string) {
  return Object.fromEntries(parseChangedLines(diff));
}

describe('the changed lines of a diff', () => {
  test('lists the new-file line numbers of added and modified lines, with or without context', () => {
    const diff = [
      'diff --git a/src/a.ts b/src/a.ts',
      'index 1..2 100644',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -2,3 +2,4 @@ export function a() {',
      ' const x = 1;',
      '-const y = 2;',
      '+const y = 3;',
      '+const z = 4;',
      ' return x;',
      '@@ -10 +11 @@',
      '-old',
      '+new',
      '\\ No newline at end of file',
    ].join('\n');
    expect(serialize(diff)).toEqual({ 'src/a.ts': [3, 4, 11] });
  });

  test('a new file counts every line, a deleted file none, a renamed file under its new path', () => {
    const diff = [
      'diff --git a/new.ts b/new.ts',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/new.ts',
      '@@ -0,0 +1,2 @@',
      '+one',
      '++++ a line that starts with three pluses',
      'diff --git a/gone.ts b/gone.ts',
      'deleted file mode 100644',
      '--- a/gone.ts',
      '+++ /dev/null',
      '@@ -1,2 +0,0 @@',
      '-one',
      '-two',
      'diff --git a/old.ts b/moved.ts',
      'similarity index 90%',
      'rename from old.ts',
      'rename to moved.ts',
      '--- a/old.ts',
      '+++ b/moved.ts',
      '@@ -1,1 +1,1 @@',
      '-before',
      '+after',
    ].join('\n');
    expect(serialize(diff)).toEqual({ 'new.ts': [1, 2], 'moved.ts': [1] });
  });

  test('reads CRLF diffs, quoted paths and plain unified diffs without git headers', () => {
    const quoted = [
      'diff --git "a/caf\\303\\251 \\"x\\".ts" "b/caf\\303\\251 \\"x\\".ts"',
      '--- "a/caf\\303\\251 \\"x\\".ts"',
      '+++ "b/caf\\303\\251 \\"x\\".ts"',
      '@@ -1 +1 @@',
      '-a',
      '+b',
    ].join('\r\n');
    expect(serialize(quoted)).toEqual({ 'café "x".ts': [1] });
    const tabbed = [
      '--- a.txt\t2024-01-01',
      '+++ a.txt\t2024-01-02',
      '@@ -1,2 +1,2 @@',
      ' a',
      '-b',
      '+c',
    ].join('\n');
    expect(serialize(tabbed)).toEqual({ 'a.txt': [2] });
    expect(serialize('+++ "b/tab\\there\\n\\\\"\n@@ -0,0 +1 @@\n+x')).toEqual({ 'tab\there\n\\': [1] });
  });

  test('an empty or binary-only diff has no changed lines', () => {
    expect(serialize('')).toEqual({});
    expect(serialize('diff --git a/a.png b/a.png\nBinary files a/a.png and b/a.png differ\n')).toEqual({});
  });
});
