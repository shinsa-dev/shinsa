import { describe, expect, it } from 'bun:test';
import type { Run } from '@shinsa/core';
import { resolveTimeline, resolveTurns } from '@/lib/chat/timeline.ts';
import { formatBrief, resolveClosing, resolveLiveStep, selectLatestAgentText } from '@/lib/chat/turns.ts';
import {
  commandTool,
  createAgentEntry,
  createBrief,
  createCallEntry,
  createErrorEntry,
  createResultEntry,
  readTool,
  shinsaTool,
} from '../../support/chat.ts';
import { createRun } from '../../support/state.ts';

const running = createRun({ id: 'r', taskId: 't', startedAt: 0 });

function liveTurn(entries: Parameters<typeof resolveTimeline>[0], run: Run = running) {
  const turn = resolveTurns(resolveTimeline(entries, []), run, 1_000).at(-1);
  if (!turn) throw new Error('No turn');
  return turn;
}

describe('selectLatestAgentText', () => {
  it('picks the newest words the agent wrote in the turn', () => {
    const turn = liveTurn([
      createAgentEntry('First look', 'interim', 1),
      createCallEntry('1', readTool('a.ts'), 2),
      createAgentEntry('Second look', 'interim', 3),
      createCallEntry('2', readTool('b.ts'), 4),
    ]);
    expect(selectLatestAgentText(turn)?.text).toBe('Second look');
  });

  it('is null before the agent has written anything', () => {
    expect(selectLatestAgentText(liveTurn([createCallEntry('1', readTool('a.ts'), 1)]))).toBeNull();
  });
});

describe('resolveLiveStep', () => {
  it('says the run is paused while it waits on your answer', () => {
    expect(resolveLiveStep(liveTurn([createCallEntry('1', commandTool('bun test'), 1)]), true)).toBe(
      'Paused until you answer'
    );
  });

  it('names the newest step still running', () => {
    const turn = liveTurn([
      createCallEntry('1', readTool('a.ts'), 1),
      createCallEntry('2', commandTool('bun test'), 2),
      createCallEntry('3', commandTool('bun lint'), 3),
      createResultEntry('3', 'clean', 4),
    ]);
    expect(resolveLiveStep(turn, false)).toBe('Running bun test');
  });

  it('keeps naming the latest step after it finished, until the next one starts', () => {
    const finished = liveTurn([
      createCallEntry('1', commandTool('bun test'), 1),
      createResultEntry('1', 'ok', 2),
      createCallEntry('2', readTool('a.ts'), 3),
      createResultEntry('2', 'text', 4),
    ]);
    expect(resolveLiveStep(finished, false)).toBe('Reading a.ts');
  });

  it('says it is thinking only once the agent spoke after its last step', () => {
    const spoke = liveTurn([
      createCallEntry('1', readTool('a.ts'), 1),
      createAgentEntry('Hmm', 'interim', 2),
    ]);
    expect(resolveLiveStep(spoke, false)).toBe('Thinking');
  });

  it('looks past the brief to the step before it', () => {
    const turn = liveTurn([createCallEntry('1', commandTool('bun test'), 1), createBrief('Phase 2', 2)]);
    expect(resolveLiveStep(turn, false)).toBe('Running bun test');
  });

  it('says it is starting when only the brief has arrived', () => {
    expect(resolveLiveStep(liveTurn([createBrief('Build it', 1)]), false)).toBe('Starting');
  });

  it('says it is starting before anything has happened', () => {
    expect(resolveLiveStep(liveTurn([]), false)).toBe('Starting');
  });

  it('does not treat a pending hand-over as the latest step', () => {
    const turn = liveTurn([
      createCallEntry('1', readTool('a.ts'), 1),
      createResultEntry('1', 'text', 2),
      createCallEntry('2', shinsaTool('propose_plan', { plan: [] }), 3),
    ]);
    expect(resolveLiveStep(turn, false)).toBe('Reading a.ts');
  });
});

function shinsaToolEntry() {
  return createCallEntry('1', shinsaTool('answer'), 1);
}

describe('resolveClosing', () => {
  const ended = (overrides: Partial<Run>) =>
    createRun({ id: 'r', taskId: 't', startedAt: 0, endedAt: 100, outcome: 'completed', ...overrides });

  function turnsFor(entries: Parameters<typeof resolveTimeline>[0], run: Run) {
    return resolveTurns(resolveTimeline(entries, []), run, 1_000);
  }

  it('shows nothing while the run is still going or when it left no summary', () => {
    expect(resolveClosing(createRun({ id: 'r', taskId: 't', summary: 'Working' }), [])).toBeNull();
    expect(resolveClosing(ended({ summary: null }), [])).toBeNull();
    expect(resolveClosing(ended({ summary: '   ' }), [])).toBeNull();
  });

  it('shows the summary as the reply when the run ended without one', () => {
    const run = ended({ summary: '  Built the login page.  ' });
    const entries = [createCallEntry('1', readTool('a.ts'), 1)];
    expect(resolveClosing(run, [])).toEqual({ kind: 'reply', text: 'Built the login page.' });
    expect(resolveClosing(run, turnsFor([createBrief('Build', 1)], run))).toEqual({
      kind: 'reply',
      text: 'Built the login page.',
    });
    expect(resolveClosing(run, turnsFor(entries, run))?.kind).toBe('reply');
  });

  it('leaves the summary out when the last turn already has a reply, a hand-over or an error', () => {
    const run = ended({ summary: 'Done' });
    expect(resolveClosing(run, turnsFor([createAgentEntry('Done it', 'final', 1)], run))).toBeNull();
    expect(
      resolveClosing(run, turnsFor([createCallEntry('1', shinsaTool('complete_phase'), 1)], run))
    ).toBeNull();
    expect(resolveClosing(run, turnsFor([createErrorEntry('Crashed', 1)], run))).toBeNull();
  });

  it('never repeats a finished run’s reply under a message the next run has not picked up yet', () => {
    const run = ended({ summary: 'Answered the question.' });
    const turns = resolveTurns(
      resolveTimeline(
        [shinsaToolEntry(), createAgentEntry('Hey! I am the answerer.', 'final', 2)],
        [{ at: 200, text: 'hey!' }]
      ),
      run,
      1_000
    );
    expect(turns.map((turn) => turn.human?.text ?? null)).toEqual([null, 'hey!']);
    expect(resolveClosing(run, turns)).toBeNull();
  });

  it('shows a failed run summary as an error unless the same error is already on screen', () => {
    const run = ended({ outcome: 'failed', summary: 'The session failed.' });
    expect(resolveClosing(run, turnsFor([createAgentEntry('Trying', 'interim', 1)], run))).toEqual({
      kind: 'error',
      text: 'The session failed.',
    });
    expect(resolveClosing(run, turnsFor([createErrorEntry(' The session failed. ', 1)], run))).toBeNull();
  });
});

describe('formatBrief', () => {
  it('keeps the brief line breaks in markdown, but not inside code fences or on blank lines', () => {
    const brief = [
      'Build the page.',
      'Then test it.',
      '',
      '```sh',
      'bun test',
      'bun lint',
      '```',
      'Done.',
    ].join('\n');
    expect(formatBrief(brief).split('\n')).toEqual([
      'Build the page.  ',
      'Then test it.  ',
      '',
      '```sh',
      'bun test',
      'bun lint',
      '```  ',
      'Done.  ',
    ]);
  });
});
