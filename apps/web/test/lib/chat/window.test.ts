import { describe, expect, it } from 'bun:test';
import type { Run, RunDelegation } from '@shinsa/core';
import {
  findRunBlock,
  GROW_BLOCKS,
  hasScrollAnchoring,
  INITIAL_BLOCKS,
  listTranscriptBlocks,
  resolveChatRunId,
  resolveGrownStart,
  resolveInitialStart,
  resolveScrollShift,
  resolveShownStart,
  shouldFill,
  shouldGrow,
} from '@/lib/chat/window.ts';
import { createRound } from '../../support/rounds.ts';
import { createRun, createTask } from '../../support/state.ts';

const task = createTask({ id: 't' });

const runs = [createRun({ id: 'a', taskId: 't' }), createRun({ id: 'b', taskId: 't', round: 2 })];

function delegated(id: string, parentRunId: string): Run {
  return createRun({ id, taskId: 't', delegation: { parentRunId } as RunDelegation });
}

describe('transcript blocks', () => {
  it('lists the messages before any run, then one block per run, the first run leading only without them', () => {
    expect(
      listTranscriptBlocks(task, runs, [], false).map((block) => [block.key, 'first' in block && block.first])
    ).toEqual([
      ['a', true],
      ['b', false],
    ]);
    const blocks = listTranscriptBlocks(
      task,
      runs,
      [
        { at: 5, text: 'hi' },
        { at: 5, text: 'hi' },
      ],
      false
    );
    expect(blocks.map((block) => block.key)).toEqual(['message-5-0', 'message-5-1', 'a', 'b']);
    expect(blocks[2]).toMatchObject({ kind: 'run', first: false });
  });

  it('puts each round’s divider before its runs, every round’s first run leading', () => {
    const rounded = createTask({ id: 't', rounds: [createRound({ number: 1 }), createRound({ number: 2 })] });
    expect(
      listTranscriptBlocks(rounded, runs, [], true).map((block) => [
        block.key,
        'first' in block && block.first,
      ])
    ).toEqual([
      ['round-1', true],
      ['a', true],
      ['round-2', false],
      ['b', true],
    ]);
    expect(listTranscriptBlocks(rounded, runs, [{ at: 1, text: 'x' }], true)[1]).toMatchObject({
      first: false,
    });
  });

  it('finds the chat run a delegated run belongs to, and its block', () => {
    const byId = Object.fromEntries(
      [...runs, delegated('d1', 'a'), delegated('d2', 'd1'), delegated('loop', 'loop')].map((run) => [
        run.id,
        run,
      ])
    );
    expect(resolveChatRunId(byId, 'd2')).toBe('a');
    expect(resolveChatRunId(byId, 'b')).toBe('b');
    expect(resolveChatRunId(byId, 'loop')).toBe('loop');
    expect(resolveChatRunId(byId, 'missing')).toBeNull();
    expect(resolveChatRunId(byId, null)).toBeNull();
    const blocks = listTranscriptBlocks(task, runs, [{ at: 1, text: 'x' }], false);
    expect(findRunBlock(blocks, 'b')).toBe(2);
    expect(findRunBlock(blocks, 'missing')).toBe(-1);
    expect(findRunBlock(blocks, null)).toBe(-1);
  });
});

describe('the rendered window', () => {
  it('starts with the newest blocks and grows toward the oldest', () => {
    expect(resolveInitialStart(3)).toBe(0);
    expect(resolveInitialStart(INITIAL_BLOCKS + 5)).toBe(5);
    expect(resolveGrownStart(GROW_BLOCKS + 2)).toBe(2);
    expect(resolveGrownStart(3)).toBe(0);
  });

  it('reaches back to the block before a focused run, and never past the last block', () => {
    expect(resolveShownStart(10, 20, -1)).toBe(10);
    expect(resolveShownStart(30, 20, -1)).toBe(19);
    expect(resolveShownStart(10, 20, 4)).toBe(3);
    expect(resolveShownStart(10, 20, 0)).toBe(0);
    expect(resolveShownStart(2, 20, 15)).toBe(2);
    expect(resolveShownStart(0, 0, -1)).toBe(0);
  });

  it('grows near the top and fills a short page, only while older blocks are left', () => {
    expect(shouldGrow(4, 100, 800)).toBe(true);
    expect(shouldGrow(4, 5000, 800)).toBe(false);
    expect(shouldGrow(0, 0, 800)).toBe(false);
    expect(shouldFill(4, 900, 800)).toBe(true);
    expect(shouldFill(4, 5000, 800)).toBe(false);
    expect(shouldFill(0, 0, 800)).toBe(false);
  });

  it('leaves the shift to the browser where it anchors the scroll, and takes it at the very top or without anchoring', () => {
    expect(resolveScrollShift(600, 120, true)).toBe(0);
    expect(resolveScrollShift(600, 0, true)).toBe(600);
    expect(resolveScrollShift(600, 120, false)).toBe(600);
  });

  it('knows whether the browser anchors the scroll', () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'CSS');
    const replaceCss = (value: unknown) =>
      Object.defineProperty(globalThis, 'CSS', { configurable: true, writable: true, value });
    try {
      replaceCss({ supports: (property: string) => property === 'overflow-anchor' });
      expect(hasScrollAnchoring()).toBe(true);
      replaceCss({ supports: () => false });
      expect(hasScrollAnchoring()).toBe(false);
      replaceCss(undefined);
      expect(hasScrollAnchoring()).toBe(false);
    } finally {
      if (original) Object.defineProperty(globalThis, 'CSS', original);
    }
  });
});
