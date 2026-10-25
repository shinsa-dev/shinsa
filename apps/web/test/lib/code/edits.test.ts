import { describe, expect, it } from 'bun:test';
import { WORKING_REF } from '@shinsa/core';
import { waitFor } from '@testing-library/react';
import {
  CONFLICT_NOTICE,
  DELETED_NOTICE,
  type FileSave,
  FileSaver,
  isEditedPath,
  mergeEdits,
  rememberSaved,
  resolveEditState,
  type SaverState,
  selectSaved,
} from '@/lib/code/edits.ts';

const OPEN = { stage: 'awaiting_review', closedAt: null, worktreePath: '/w' } as const;

describe('resolveEditState', () => {
  it('edits the head or the working copy of an open task, and says why anything else is read-only', () => {
    const refs = { head: 'h' };
    expect(resolveEditState({ task: OPEN, refs, gitRef: 'h', headPath: 'a.ts' })).toEqual({
      editable: true,
      reason: null,
    });
    expect(resolveEditState({ task: OPEN, refs, gitRef: WORKING_REF, headPath: 'a.ts' }).editable).toBe(true);
    expect(resolveEditState({ task: OPEN, refs, gitRef: 'old', headPath: 'a.ts' })).toEqual({
      editable: false,
      reason: 'This is an earlier commit, so it is read-only. Pick Head of the branch to edit.',
    });
    expect(resolveEditState({ task: OPEN, refs, gitRef: 'h', headPath: null })).toEqual({
      editable: false,
      reason: null,
    });
    expect(
      resolveEditState({ task: { ...OPEN, stage: 'merged' }, refs, gitRef: 'h', headPath: 'a.ts' }).reason
    ).toBe('This task is merged, so its code is read-only.');
  });
});

describe('isEditedPath', () => {
  it('knows the files you edited that are not committed yet', () => {
    expect(isEditedPath({ editedPaths: ['a.ts'] }, 'a.ts')).toBe(true);
    expect(isEditedPath({ editedPaths: ['a.ts'] }, 'b.ts')).toBe(false);
    expect(isEditedPath({}, 'a.ts')).toBe(false);
    expect(isEditedPath({ editedPaths: ['a.ts'] }, null)).toBe(false);
  });
});

describe('mergeEdits', () => {
  it('keeps both sides when they changed different places, and a change both made once', () => {
    expect(mergeEdits('one\ntwo\nthree\n', 'ONE\ntwo\nthree\n', 'one\ntwo\nTHREE\n')).toBe(
      'ONE\ntwo\nTHREE\n'
    );
    expect(mergeEdits('one\ntwo\n', 'one\nTWO\n', 'zero\none\nTWO\n')).toBe('zero\none\nTWO\n');
  });

  it('gives up when both changed the same place differently', () => {
    expect(mergeEdits('one\ntwo\n', 'one\nmine\n', 'one\ntheirs\n')).toBeNull();
    expect(mergeEdits('ab', 'aXb', 'aYb')).toBeNull();
    expect(mergeEdits('one two\n', 'one TWO\n', 'ONE two\n')).toBeNull();
    const huge = Array.from({ length: 56_000 }, (_, index) => `line ${index}\n`).join('');
    expect(mergeEdits(huge, `${huge}a\n`, `b\n${huge}`)).toBeNull();
  });
});

describe('what you saved', () => {
  it('is shown again over the same read, and not over a newer one', () => {
    rememberSaved('t1', 'a.ts', 'read', 'saved');
    expect(selectSaved('t1', 'a.ts', 'read')).toBe('saved');
    expect(selectSaved('t1', 'a.ts', 'newer')).toBeNull();
    expect(selectSaved('t1', 'b.ts', 'read')).toBeNull();
  });
});

function createSaver(disk: string | null, answers: (FileSave | Error | string)[], delayMs = 60_000) {
  const buffer = { text: disk ?? '' };
  const saves: { text: string; base: string | null }[] = [];
  const states: SaverState[] = [];
  const saved: string[] = [];
  const saver = new FileSaver(disk, {
    save: (text, base) => {
      saves.push({ text, base });
      const answer = answers.shift() ?? { kind: 'saved', changed: true };
      if (answer instanceof Error || typeof answer === 'string') return Promise.reject(answer);
      return Promise.resolve(answer);
    },
    read: () => buffer.text,
    apply: (text) => {
      buffer.text = text;
    },
    onSaved: (text) => saved.push(text),
    onState: (state) => states.push(state),
    delayMs,
  });
  const type = (text: string) => {
    buffer.text = text;
    saver.edit();
  };
  return { saver, buffer, saves, states, saved, type };
}

describe('FileSaver', () => {
  it('saves on its own a moment after you stop typing', async () => {
    const { saves, type } = createSaver('a', [], 1);
    type('b');
    await waitFor(() => expect(saves).toEqual([{ text: 'b', base: 'a' }]));
  });

  it('saves what you typed against what is on disk, and nothing when nothing changed', async () => {
    const { saver, saves, saved, type, states } = createSaver('a\n', []);
    await saver.flush();
    expect(saves).toEqual([]);
    type('b\n');
    type('c\n');
    await saver.flush();
    expect(saves).toEqual([{ text: 'c\n', base: 'a\n' }]);
    expect(saved).toEqual(['c\n']);
    expect(saver.disk).toBe('c\n');
    expect(states.at(-1)).toEqual({ saving: false, notice: null, refusal: null });
    saver.dispose();
  });

  it('saves again once a save in flight is done, when you typed meanwhile', async () => {
    let finish = (_answer: FileSave) => {};
    const pending = new Promise<FileSave>((resolve) => {
      finish = resolve;
    });
    const buffer = { text: 'a' };
    const saves: string[] = [];
    const saver = new FileSaver('a', {
      save: (text) => {
        saves.push(text);
        return saves.length === 1 ? pending : Promise.resolve({ kind: 'saved', changed: true });
      },
      read: () => buffer.text,
      apply: () => {},
      onSaved: () => {},
      onState: () => {},
      delayMs: 60_000,
    });
    buffer.text = 'b';
    saver.edit();
    const first = saver.flush();
    saver.reload('a', 'b');
    buffer.text = 'c';
    saver.edit();
    const second = saver.flush();
    finish({ kind: 'saved', changed: true });
    await Promise.all([first, second]);
    expect(saves).toEqual(['b', 'c']);
    expect(buffer.text).toBe('c');
  });

  it('keeps your edit when the file changed elsewhere on disk, and saves the two together', async () => {
    const { saver, buffer, saves, type } = createSaver('one\ntwo\n', [
      { kind: 'changed', content: 'one\ntwo\nthree\n' },
    ]);
    type('ONE\ntwo\n');
    await saver.flush();
    expect(buffer.text).toBe('ONE\ntwo\nthree\n');
    await saver.flush();
    expect(saves.at(-1)).toEqual({ text: 'ONE\ntwo\nthree\n', base: 'one\ntwo\nthree\n' });
  });

  it('shows the disk version with a notice when your edit and the disk’s overlap', async () => {
    const { saver, buffer, states, type } = createSaver('one\n', [{ kind: 'changed', content: 'theirs\n' }]);
    type('mine\n');
    await saver.flush();
    expect(buffer.text).toBe('theirs\n');
    expect(states.at(-1)?.notice).toBe(CONFLICT_NOTICE);
    type('again\n');
    expect(states.at(-1)?.notice).toBeNull();
    saver.dispose();
  });

  it('says so when the file was deleted on disk, and puts it back with your next edit', async () => {
    const { saver, states, saves, type } = createSaver('one\n', [{ kind: 'changed', content: null }]);
    type('two\n');
    await saver.flush();
    expect(states.at(-1)?.notice).toBe(DELETED_NOTICE);
    type('three\n');
    await saver.flush();
    expect(saves.at(-1)).toEqual({ text: 'three\n', base: null });
  });

  it('stops saving once Shinsa refuses, and says why', async () => {
    const { saver, states, saves, type } = createSaver('one\n', [new Error('This task is merged.')]);
    type('two\n');
    await saver.flush();
    expect(states.at(-1)?.refusal).toBe('This task is merged.');
    type('three\n');
    await saver.flush();
    expect(saves).toHaveLength(1);
    const odd = createSaver('one\n', ['offline']);
    odd.type('two\n');
    await odd.saver.flush();
    expect(odd.states.at(-1)?.refusal).toBe('offline');
  });

  it('takes a newer read from disk, merging it with your unsaved edit', () => {
    const { saver, buffer, type } = createSaver('one\ntwo\n', []);
    saver.reload('one\ntwo\n', 'one\ntwo\n');
    type('ONE\ntwo\n');
    saver.reload('one\ntwo\n', 'one\nTWO\n');
    expect(buffer.text).toBe('ONE\nTWO\n');
    saver.reload('one\nTWO\n', 'ONE\nTWO\n');
    expect(saver.disk).toBe('ONE\nTWO\n');
    saver.dispose();
  });
});
