import { describe, expect, test } from 'bun:test';
import { mapChangedLines, parseChangedLines } from '../../src/test-coverage/diff.ts';

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

describe('moving changed lines through a later diff', () => {
  function map(changed: Record<string, number[]>, drift: string) {
    return Object.fromEntries(mapChangedLines(new Map(Object.entries(changed)), drift));
  }

  test('shifts lines past insertions and replacements, and drops the lines the later diff rewrote', () => {
    const drift = [
      'diff --git a/src/a.ts b/src/a.ts',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -20,2 +22,1 @@',
      '-twenty',
      '-twenty-one',
      '+merged',
      '@@ -0,0 +1,2 @@',
      '+top one',
      '+top two',
      '@@ -5 +7 @@',
      '-five',
      '+FIVE',
    ].join('\n');
    expect(map({ 'src/a.ts': [1, 4, 5, 6, 20, 21, 30] }, drift)).toEqual({ 'src/a.ts': [3, 6, 8, 31] });
  });

  test('an insertion after a line moves only the lines below it', () => {
    const drift = ['--- a/b.ts', '+++ b/b.ts', '@@ -3,0 +4,2 @@', '+x', '+y'].join('\n');
    expect(map({ 'b.ts': [3, 4] }, drift)).toEqual({ 'b.ts': [3, 6] });
  });

  test('a file the later diff leaves alone keeps its lines; a deleted or fully rewritten one drops out', () => {
    const drift = [
      'diff --git a/gone.ts b/gone.ts',
      '--- a/gone.ts',
      '+++ /dev/null',
      '@@ -1,2 +0,0 @@',
      '-one',
      '-two',
      'diff --git a/rewritten.ts b/rewritten.ts',
      '--- a/rewritten.ts',
      '+++ b/rewritten.ts',
      '@@ -1 +1 @@',
      '-old',
      '+new',
      'diff --git a/added.ts b/added.ts',
      '--- /dev/null',
      '+++ b/added.ts',
      '@@ -0,0 +1 @@',
      '+fresh',
    ].join('\n');
    expect(map({ 'same.ts': [2], 'gone.ts': [1], 'rewritten.ts': [1] }, drift)).toEqual({ 'same.ts': [2] });
  });

  test('a renamed file carries its lines to the new path', () => {
    const drift = [
      'diff --git a/old.ts b/new.ts',
      'rename from old.ts',
      'rename to new.ts',
      '--- a/old.ts',
      '+++ b/new.ts',
      '@@ -1 +1,2 @@',
      '-a',
      '+b',
      '+c',
    ].join('\n');
    expect(map({ 'old.ts': [1, 2] }, drift)).toEqual({ 'new.ts': [3] });
  });
});
