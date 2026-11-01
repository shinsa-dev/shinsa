import { describe, expect, it } from 'bun:test';
import type { DiffFile } from '@shinsa/core';
import {
  countDiffRows,
  createContextHunk,
  hasDiffBody,
  hasHunks,
  narrowHunks,
  resolveDiffClamp,
  resolveDiffNote,
  resolveFileSource,
  resolveSpotSource,
  serializePatch,
  terminateText,
} from '@/lib/code/diff-view.ts';

const PATCH = [
  '@@ -1,6 +1,7 @@',
  ' one',
  ' two',
  '-three',
  '+THREE',
  '+three and a half',
  ' four',
  ' five',
  ' six',
  '@@ -40,3 +41,3 @@',
  ' forty',
  '-forty-one',
  '+FORTY-ONE',
  ' forty-two',
].join('\n');

function createDiffFile(overrides: Partial<DiffFile> = {}): DiffFile {
  return {
    path: 'src/a.ts',
    previousPath: null,
    status: 'modified',
    additions: 3,
    deletions: 2,
    risk: 'normal',
    riskReason: null,
    binary: false,
    patch: `diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n${PATCH}\n`,
    ...overrides,
  };
}

describe('narrowHunks', () => {
  it('keeps the changed lines around the asked lines, with fresh line counts', () => {
    expect(narrowHunks(PATCH, { start: 3, end: 3 })).toBe(
      ['@@ -1,4 +1,5 @@', ' one', ' two', '-three', '+THREE', '+three and a half', ' four'].join('\n')
    );
  });

  it('keeps only the hunk the lines fall in', () => {
    expect(narrowHunks(PATCH, { start: 42, end: 42 })).toBe(
      ['@@ -40,3 +41,3 @@', ' forty', '-forty-one', '+FORTY-ONE', ' forty-two'].join('\n')
    );
  });

  it('has nothing when no change is near the lines', () => {
    expect(narrowHunks(PATCH, { start: 20, end: 22 })).toBeNull();
    expect(narrowHunks('', { start: 1, end: 1 })).toBeNull();
  });

  it('starts a slice of a new file after line zero of the old one', () => {
    const added = ['@@ -0,0 +1,5 @@', '+a', '+b', '+c', '+d', '+e'].join('\n');
    expect(narrowHunks(added, { start: 5, end: 5 })).toBe(['@@ -0,0 +3,3 @@', '+c', '+d', '+e'].join('\n'));
  });

  it('starts a slice that only removes lines before the line that follows them', () => {
    const removed = ['@@ -1,2 +0,0 @@', '-a', '-b'].join('\n');
    expect(narrowHunks(removed, { start: 1, end: 1 })).toBe(['@@ -1,2 +0,0 @@', '-a', '-b'].join('\n'));
  });

  it('shows the marked lines and two rows around them, not a long removal before them', () => {
    const replaced = [
      '@@ -1,12 +1,4 @@',
      ' keep',
      ...Array.from({ length: 10 }, (_, index) => `-old ${index + 1}`),
      '+new',
      ' after one',
      ' after two',
      ' after three',
    ].join('\n');
    expect(narrowHunks(replaced, { start: 2, end: 2 })).toBe(
      ['@@ -9,5 +2,3 @@', '-old 8', '-old 9', '-old 10', '+new', ' after one', ' after two'].join('\n')
    );
  });

  it('keeps a whole removal when the marked line is where the lines were removed', () => {
    const removed = ['@@ -4,5 +4,2 @@', ' four', '-five', '-six', '-seven', ' eight'].join('\n');
    expect(narrowHunks(removed, { start: 5, end: 5 })).toBe(
      ['@@ -4,5 +4,2 @@', ' four', '-five', '-six', '-seven', ' eight'].join('\n')
    );
  });

  it('numbers an insertion in the middle of a file after the line it follows', () => {
    const inserted = ['@@ -5,0 +6,2 @@', '+a', '+b'].join('\n');
    expect(narrowHunks(inserted, { start: 6, end: 6 })).toBe(['@@ -5,0 +6,2 @@', '+a', '+b'].join('\n'));
  });

  it('has nothing when the marked lines are unchanged lines of a hunk far from its change', () => {
    const far = ['@@ -1,8 +1,8 @@', '-a', '+A', ' b', ' c', ' d', ' e', ' f', ' g'].join('\n');
    expect(narrowHunks(far, { start: 7, end: 7 })).toBeNull();
  });
});

describe('resolveFileSource', () => {
  it('shows a whole file’s hunks without its git headers', () => {
    expect(resolveFileSource(createDiffFile())).toEqual({
      kind: 'patch',
      path: 'src/a.ts',
      previousPath: null,
      hunks: PATCH,
      binary: false,
    });
  });

  it('keeps a rename or a binary file with no hunks to show', () => {
    const renamed = resolveFileSource(
      createDiffFile({
        previousPath: 'src/old.ts',
        patch: 'diff --git a/src/old.ts b/src/a.ts\nrename from src/old.ts\n',
      })
    );
    expect(renamed).toMatchObject({ previousPath: 'src/old.ts', hunks: '' });
    expect(resolveFileSource(createDiffFile({ binary: true, patch: 'Binary files differ' }))).toMatchObject({
      binary: true,
      hunks: '',
    });
  });
});

describe('createContextHunk', () => {
  it('shows the asked lines of a file with a little context as unchanged lines', () => {
    expect(createContextHunk('a\nb\nc\nd\ne\nf\ng\n', { start: 4, end: 4 })).toBe(
      ['@@ -2,5 +2,5 @@', ' b', ' c', ' d', ' e', ' f'].join('\n')
    );
  });

  it('stays inside the file and stops at fourteen lines', () => {
    const content = Array.from({ length: 40 }, (_, index) => `line ${index + 1}`).join('\n');
    const hunk = createContextHunk(content, { start: 1, end: 30 });
    expect(hunk.split('\n')[0]).toBe('@@ -1,14 +1,14 @@');
    expect(createContextHunk('a\nb', { start: 9, end: 9 }).split('\n')[0]).toBe('@@ -1,2 +1,2 @@');
  });
});

describe('resolveSpotSource', () => {
  const lines = { start: 3, end: 3 };

  it('shows the change near the spot from the task diff', () => {
    expect(resolveSpotSource('src/a.ts', createDiffFile(), 'unused', lines)).toEqual({
      kind: 'patch',
      path: 'src/a.ts',
      previousPath: null,
      hunks: narrowHunks(PATCH, lines) ?? '',
      binary: false,
    });
  });

  it('says a binary file is binary', () => {
    expect(
      resolveSpotSource('logo.png', createDiffFile({ binary: true, previousPath: 'old.png' }), null, lines)
    ).toEqual({ kind: 'patch', path: 'logo.png', previousPath: 'old.png', hunks: '', binary: true });
  });

  it('falls back to the file at its lines when the change does not reach them', () => {
    expect(resolveSpotSource('src/a.ts', createDiffFile(), 'a\nb\nc\n', { start: 20, end: 20 })).toEqual({
      kind: 'patch',
      path: 'src/a.ts',
      previousPath: null,
      hunks: createContextHunk('a\nb\nc\n', { start: 20, end: 20 }),
      binary: false,
    });
    expect(resolveSpotSource('src/b.ts', null, 'x\n', lines)?.kind).toBe('patch');
  });

  it('has nothing to show without the change or the file', () => {
    expect(resolveSpotSource('src/b.ts', null, null, lines)).toBeNull();
    expect(resolveSpotSource('src/b.ts', null, '', lines)).toBeNull();
  });
});

describe('serializePatch and terminateText', () => {
  it('writes a patch the renderer reads, renamed when the path moved', () => {
    expect(
      serializePatch({
        kind: 'patch',
        path: 'b.ts',
        previousPath: null,
        hunks: '@@ -1 +1 @@\n-a\n+b',
        binary: false,
      })
    ).toBe('--- b.ts\n+++ b.ts\n@@ -1 +1 @@\n-a\n+b\n');
    expect(
      serializePatch({ kind: 'patch', path: 'b.ts', previousPath: 'a.ts', hunks: '', binary: false })
    ).toBe('--- a.ts\n+++ b.ts\n\n');
  });

  it('ends text with a newline so a snippet is not marked as missing one', () => {
    expect(terminateText('a')).toBe('a\n');
    expect(terminateText('a\n')).toBe('a\n');
    expect(terminateText('')).toBe('');
    expect(terminateText(null)).toBeNull();
  });
});

describe('resolveDiffNote and hasDiffBody', () => {
  const patch = { kind: 'patch' as const, path: 'b.ts', previousPath: null, hunks: PATCH, binary: false };

  it('shows the lines of a change and says nothing about them', () => {
    expect(resolveDiffNote(patch)).toBeNull();
    expect(hasDiffBody(patch)).toBe(true);
    const files = { kind: 'files' as const, path: 'a.ts', before: 'a', after: 'b' };
    expect(resolveDiffNote(files)).toBeNull();
    expect(hasDiffBody(files)).toBe(true);
    expect(hasDiffBody({ ...files, before: null })).toBe(true);
  });

  it('says when nothing changed', () => {
    const same = { kind: 'files' as const, path: 'a.ts', before: 'a', after: 'a' };
    expect(resolveDiffNote(same)).toBe('No line changed.');
    expect(hasDiffBody(same)).toBe(false);
  });

  it('says a binary file is not shown', () => {
    const binary = { ...patch, binary: true };
    expect(resolveDiffNote(binary)).toBe('A binary file, not shown as text.');
    expect(hasDiffBody(binary)).toBe(false);
  });

  it('names where a renamed file came from', () => {
    expect(resolveDiffNote({ ...patch, previousPath: 'a.ts' })).toBe('Renamed from a.ts.');
    expect(resolveDiffNote({ ...patch, previousPath: 'b.ts' })).toBeNull();
    expect(resolveDiffNote({ ...patch, previousPath: 'a.ts', hunks: '' })).toBe(
      'Renamed from a.ts, with no line changed.'
    );
    expect(hasDiffBody({ ...patch, hunks: '@@ -1 +1 @@' })).toBe(false);
    expect(hasHunks('@@ -1 +1 @@\n a')).toBe(true);
  });
});

describe('countDiffRows and resolveDiffClamp', () => {
  it('counts the shown lines and a separator before every later hunk with a gap', () => {
    expect(
      countDiffRows([
        { unifiedLineCount: 5, collapsedBefore: 3 },
        { unifiedLineCount: 4, collapsedBefore: 10 },
        { unifiedLineCount: 2, collapsedBefore: 0 },
      ])
    ).toBe(12);
    expect(countDiffRows([])).toBe(0);
  });

  it('shows a short diff whole and folds a long one after fourteen lines', () => {
    expect(resolveDiffClamp(16, false)).toEqual({ maxHeight: null, hidden: 0 });
    expect(resolveDiffClamp(30, false)).toEqual({ maxHeight: 252, hidden: 16 });
    expect(resolveDiffClamp(30, true)).toEqual({ maxHeight: null, hidden: 0 });
  });
});
