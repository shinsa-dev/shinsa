import { describe, expect, it } from 'bun:test';
import type { Activity, ChatEntry } from '@shinsa/core';
import {
  listHumanMessages,
  resolveLastAgentText,
  resolveLastHandover,
  resolveRunMessages,
  resolveTimeline,
  resolveTurns,
  type TimelineItem,
  type TimelineItemOf,
} from '@/lib/chat/timeline.ts';
import {
  commandTool,
  createAgentEntry,
  createBrief,
  createCallEntry,
  createErrorEntry,
  createNoticeEntry,
  createResultEntry,
  createStatusEntry,
  createUserEntry,
  readTool,
  shinsaTool,
} from '../../support/chat.ts';
import { createRun, createTask, NOW } from '../../support/state.ts';

function activity(overrides: Partial<Activity>): Activity {
  return {
    at: NOW,
    actor: 'you',
    kind: 'message',
    text: 'Sent a message',
    detail: null,
    evidenceId: null,
    ...overrides,
  };
}

function only<K extends TimelineItem['kind']>(items: TimelineItem[], kind: K) {
  return items.filter((item): item is TimelineItemOf<K> => item.kind === kind);
}

describe('listHumanMessages', () => {
  it('keeps what you asked and wrote, in order, and drops everything else', () => {
    const task = createTask({
      id: 't',
      activity: [
        activity({ at: 1, kind: 'asked', detail: 'Fix the login page' }),
        activity({ at: 2, actor: 'agent', kind: 'message', detail: 'Agent words' }),
        activity({ at: 3, kind: 'decision', detail: 'Approved' }),
        activity({ at: 4, kind: 'message', detail: 'Also the footer' }),
        activity({ at: 5, kind: 'message', detail: null }),
      ],
    });
    expect(listHumanMessages(task)).toEqual([
      { at: 1, text: 'Fix the login page' },
      { at: 4, text: 'Also the footer' },
    ]);
  });

  it('is empty for a task with no activity', () => {
    expect(listHumanMessages(createTask({ id: 't' }))).toEqual([]);
  });
});

describe('resolveRunMessages', () => {
  const first = createRun({ id: 'a', taskId: 't', startedAt: 100 });
  const second = createRun({ id: 'b', taskId: 't', startedAt: 200 });

  it('gives each message to the latest run that started before it', () => {
    const messages = [
      { at: 50, text: 'before' },
      { at: 150, text: 'during a' },
      { at: 250, text: 'during b' },
    ];
    const { preamble, byRun } = resolveRunMessages([first, second], messages);
    expect(preamble).toEqual([{ at: 50, text: 'before' }]);
    expect(byRun.get('a')).toEqual([{ at: 150, text: 'during a' }]);
    expect(byRun.get('b')).toEqual([{ at: 250, text: 'during b' }]);
  });

  it('puts a message above the run it started, which begins at the same moment', () => {
    const { preamble, byRun } = resolveRunMessages([first, second], [{ at: 200, text: 'go' }]);
    expect(preamble).toEqual([]);
    expect(byRun.get('a')).toEqual([]);
    expect(byRun.get('b')).toEqual([{ at: 200, text: 'go' }]);
  });

  it('puts every message in the preamble when no agent has run yet', () => {
    const { preamble, byRun } = resolveRunMessages([], [{ at: 10, text: 'hi' }]);
    expect(preamble).toEqual([{ at: 10, text: 'hi' }]);
    expect(byRun.size).toBe(0);
  });
});

describe('resolveTimeline', () => {
  it('merges your messages into the transcript by time', () => {
    const items = resolveTimeline(
      [createAgentEntry('one', 'interim', 10), createAgentEntry('two', 'final', 30)],
      [
        { at: 5, text: 'first' },
        { at: 20, text: 'middle' },
        { at: 40, text: 'last' },
      ]
    );
    expect(
      items.map((item) => (item.kind === 'human' || item.kind === 'agent' ? item.text : item.kind))
    ).toEqual(['first', 'one', 'middle', 'two', 'last']);
    expect(only(items, 'human').every((item) => item.attachments.length === 0)).toBe(true);
  });

  it('leaves a subagent’s own steps and the run notices out of the main timeline', () => {
    const nested = { ...createAgentEntry('sub work', 'interim', 12), parentCallId: 'task-1' };
    const notice: ChatEntry = {
      v: 2,
      id: 'notice-1',
      at: 13,
      type: 'notice',
      notice: { kind: 'interrupted' },
    };
    const items = resolveTimeline([createAgentEntry('main', 'final', 11), nested, notice], []);
    expect(items.map((item) => (item.kind === 'agent' ? item.text : item.kind))).toEqual(['main']);
  });

  it('puts a message ahead of the brief of the run it started at the same moment', () => {
    const items = resolveTimeline([createBrief('Fix it', 10)], [{ at: 10, text: 'make it blue' }]);
    expect(items.map((item) => item.kind)).toEqual(['human', 'instructions']);
  });

  it('marks only the first brief from Shinsa as the first', () => {
    const items = only(
      resolveTimeline([createBrief('Build it', 1), createBrief('Phase 2', 2)], []),
      'instructions'
    );
    expect(items.map((item) => [item.text, item.first])).toEqual([
      ['Build it', true],
      ['Phase 2', false],
    ]);
  });

  it('keeps the attachments of a transcript message that repeats your message', () => {
    const attachment = {
      kind: 'image' as const,
      name: 'shot.png',
      url: '/api/media/shot.png',
      mimeType: 'image/png',
      size: 10,
    };
    const items = resolveTimeline(
      [createUserEntry('look at this', 20, [attachment])],
      [{ at: 10, text: 'look at this' }]
    );
    expect(only(items, 'human').map((item) => [item.text, item.attachments])).toEqual([
      ['look at this', [attachment]],
    ]);
  });

  it('shows a transcript message from you with its attachments', () => {
    const attachment = {
      kind: 'image' as const,
      name: 'shot.png',
      url: '/api/x.png',
      mimeType: 'image/png',
      size: 10,
    };
    const items = only(resolveTimeline([createUserEntry('Look at this', 1, [attachment])], []), 'human');
    expect(items).toHaveLength(1);
    expect(items[0]?.attachments).toEqual([attachment]);
  });

  it('hides the transcript echo of a message already shown from the task', () => {
    const items = resolveTimeline(
      [createUserEntry('  Also the footer\n', 20)],
      [{ at: 15, text: 'Also the footer' }]
    );
    expect(only(items, 'human').map((item) => item.at)).toEqual([15]);
  });

  it('groups consecutive tool calls into one row and starts a new group after any other item', () => {
    const items = resolveTimeline(
      [
        createCallEntry('1', readTool('a.ts'), 1),
        createCallEntry('2', commandTool('bun test'), 2),
        createAgentEntry('Looking further', 'interim', 3),
        createCallEntry('3', readTool('b.ts'), 4),
      ],
      []
    );
    expect(items.map((item) => item.kind)).toEqual(['tools', 'agent', 'tools']);
    expect(only(items, 'tools').map((item) => item.calls.length)).toEqual([2, 1]);
  });

  it('breaks a tool group at your message, a brief and an error', () => {
    const items = resolveTimeline(
      [
        createCallEntry('1', readTool('a.ts'), 1),
        createCallEntry('2', readTool('b.ts'), 3),
        createBrief('More', 4),
        createCallEntry('3', readTool('c.ts'), 5),
        createErrorEntry('Session failed', 6),
        createCallEntry('4', readTool('d.ts'), 7),
      ],
      [{ at: 2, text: 'stop' }]
    );
    expect(items.map((item) => item.kind)).toEqual([
      'tools',
      'human',
      'tools',
      'instructions',
      'tools',
      'error',
      'tools',
    ]);
  });

  it('pulls hand-overs out of tool groups as their own cards', () => {
    const items = resolveTimeline(
      [
        createCallEntry('1', readTool('a.ts'), 1),
        createCallEntry('2', shinsaTool('propose_plan', { plan: [] }), 2),
        createCallEntry('3', shinsaTool('note', { note: 'x' }), 3),
      ],
      []
    );
    expect(items.map((item) => item.kind)).toEqual(['tools', 'handover', 'tools']);
    expect(only(items, 'handover')[0]?.call.description.verb).toBe('Proposed the plan');
  });

  it('ignores status entries without breaking the tool group', () => {
    const items = resolveTimeline(
      [
        createCallEntry('1', readTool('a.ts'), 1),
        createStatusEntry('working', 2),
        createCallEntry('2', readTool('b.ts'), 3),
      ],
      []
    );
    expect(items).toHaveLength(1);
    expect(only(items, 'tools')[0]?.calls).toHaveLength(2);
  });

  it('matches results to their calls by call id, in any order', () => {
    const items = resolveTimeline(
      [
        createCallEntry('a', readTool('a.ts'), 1),
        createCallEntry('b', commandTool('bun test'), 2),
        createResultEntry('b', 'tests failed', 3, { status: 'error', images: ['/api/evidence/b.png'] }),
        createResultEntry('a', 'file a', 4),
      ],
      []
    );
    const [a, b] = only(items, 'tools')[0]?.calls ?? [];
    expect([a?.result, a?.failed, a?.images]).toEqual(['file a', false, []]);
    expect([b?.result, b?.failed, b?.images]).toEqual(['tests failed', true, ['/api/evidence/b.png']]);
  });

  it('gives a result with an unknown call id to the oldest call still waiting', () => {
    const items = resolveTimeline(
      [
        createCallEntry('a', readTool('a.ts'), 1),
        createResultEntry('a', 'file a', 2),
        createCallEntry('b', readTool('b.ts'), 3),
        createCallEntry('c', readTool('c.ts'), 4),
        createResultEntry('lost', 'file b', 5),
      ],
      []
    );
    expect(only(items, 'tools')[0]?.calls.map((call) => call.result)).toEqual(['file a', 'file b', null]);
  });

  it('pairs results with calls that share an empty call id one by one', () => {
    const items = resolveTimeline(
      [
        createCallEntry('', readTool('a.ts'), 1),
        createResultEntry('', 'file a', 2),
        createCallEntry('', readTool('b.ts'), 3),
        createResultEntry('', 'file b', 4),
      ],
      []
    );
    const calls = only(items, 'tools').flatMap((item) => item.calls);
    expect(calls.map((call) => call.result)).toEqual(['file a', 'file b']);
  });

  it('lets a repeated result update its own call instead of another waiting one', () => {
    const items = resolveTimeline(
      [
        createCallEntry('a', readTool('a.ts'), 1),
        createResultEntry('a', 'partial', 2),
        createCallEntry('b', readTool('b.ts'), 3),
        createResultEntry('a', 'complete', 4),
      ],
      []
    );
    expect(only(items, 'tools')[0]?.calls.map((call) => call.result)).toEqual(['complete', null]);
  });

  it('drops a result that arrives when no call is waiting', () => {
    const items = resolveTimeline([createResultEntry('x', 'orphan', 1)], []);
    expect(items).toEqual([]);
  });

  it('fills a hand-over card with its result', () => {
    const items = resolveTimeline(
      [
        createCallEntry('q', shinsaTool('ask', { question: 'Which?' }), 1),
        createResultEntry('q', 'The first', 2),
      ],
      []
    );
    expect(only(items, 'handover')[0]?.call.result).toBe('The first');
  });

  it('is empty for an empty transcript and no messages', () => {
    expect(resolveTimeline([], [])).toEqual([]);
  });
});

describe('resolveTurns', () => {
  const finished = createRun({ id: 'r', taskId: 't', startedAt: 0, endedAt: 100, outcome: 'completed' });
  const running = createRun({ id: 'r', taskId: 't', startedAt: 0 });

  it('puts an account switch ahead of the work of its turn without breaking a tool group', () => {
    const items = resolveTimeline(
      [
        createCallEntry('1', readTool('a.ts'), 1),
        createNoticeEntry(
          {
            kind: 'account_switched',
            email: 'b@example.com',
            previous: 'a@example.com',
            reason: 'usage_limit',
          },
          2,
          'switch'
        ),
        createCallEntry('2', readTool('b.ts'), 3),
        createAgentEntry('Done', 'final', 4),
      ],
      []
    );
    const [turn] = resolveTurns(items, finished, 500);
    expect(turn?.notices).toEqual([
      { kind: 'account', key: 'switch', at: 2, email: 'b@example.com', reason: 'usage_limit' },
    ]);
    expect(turn?.work.map((item) => item.kind)).toEqual(['tools']);
    expect(turn?.steps).toBe(2);
  });

  it('keeps a compaction as a notice of its turn, as the transcript keeps it', () => {
    const items = resolveTimeline(
      [
        createCallEntry('1', readTool('a.ts'), 1),
        createNoticeEntry(
          { kind: 'compaction', trigger: 'manual', preTokens: 140_000, summary: null },
          2,
          'compact'
        ),
        createAgentEntry('Done', 'final', 3),
      ],
      []
    );
    const [turn] = resolveTurns(items, finished, 500);
    expect(turn?.notices).toEqual([
      { kind: 'compaction', key: 'compact', at: 2, trigger: 'manual', by: 'claude' },
    ]);
    expect(turn?.work.map((item) => item.kind)).toEqual(['tools']);
  });

  it('keeps eunoe’s folds, a missing eunoe and fast mode that could not run as quiet notices of their turn', () => {
    const items = resolveTimeline(
      [
        createNoticeEntry(
          { kind: 'proxy', proxy: 'eunoe', status: 'unavailable', detail: 'down' },
          1,
          'proxy'
        ),
        createNoticeEntry({ kind: 'fast_mode', status: 'unavailable', reason: 'free' }, 2, 'fast'),
        createCallEntry('1', readTool('a.ts'), 3),
        createNoticeEntry(
          { kind: 'compaction', trigger: 'fold', preTokens: null, summary: null, by: 'eunoe' },
          4,
          'fold'
        ),
        createAgentEntry('Done', 'final', 5),
      ],
      []
    );
    const [turn] = resolveTurns(items, finished, 500);
    expect(turn?.notices).toEqual([
      { kind: 'proxy', key: 'proxy', at: 1, detail: 'down' },
      { kind: 'fast_mode', key: 'fast', at: 2, status: 'unavailable', reason: 'free' },
      { kind: 'compaction', key: 'fold', at: 4, trigger: 'fold', by: 'eunoe' },
    ]);
  });

  it('keeps what a run loaded at its start as a quiet notice of its turn', () => {
    const loaded = {
      servers: [{ name: 'linear', tokens: 4_200 }],
      skills: [{ name: 'review', tokens: 900 }],
      plugins: [],
    };
    const items = resolveTimeline(
      [
        createNoticeEntry({ kind: 'extensions', ...loaded }, 1, 'loaded'),
        createAgentEntry('Done', 'final', 2),
      ],
      []
    );
    const [turn] = resolveTurns(items, finished, 500);
    expect(turn?.notices).toEqual([{ kind: 'extensions', key: 'loaded', at: 1, ...loaded }]);
  });

  it('keeps a hand-over as a notice of its turn and leaves the other run notices in the transcript', () => {
    const items = resolveTimeline(
      [
        createNoticeEntry(
          {
            kind: 'handoff',
            reason: 'session_restore',
            fromProvider: 'Claude',
            toProvider: 'Claude',
            totalEntries: 30,
            includedEntries: 24,
          },
          1,
          'handoff'
        ),
        createNoticeEntry({ kind: 'interrupted' }, 2),
        createNoticeEntry({ kind: 'context', usedTokens: 1, maxTokens: 2, totalProcessedTokens: null }, 3),
        createNoticeEntry({ kind: 'account', email: 'a@example.com', organization: null, plan: 'max' }, 4),
        createNoticeEntry(
          { kind: 'rate_limit', status: 'allowed', limit: null, resetsAt: null, utilization: null },
          5
        ),
        createAgentEntry('Done', 'final', 6),
      ],
      []
    );
    const [turn] = resolveTurns(items, finished, 500);
    expect(turn?.notices).toEqual([
      {
        kind: 'handoff',
        key: 'handoff',
        at: 1,
        reason: 'session_restore',
        fromProvider: 'Claude',
        toProvider: 'Claude',
        totalEntries: 30,
        includedEntries: 24,
      },
    ]);
    expect(items.map((item) => item.kind)).toEqual(['handoff', 'agent']);
  });

  it('keeps delegated work as notices of its turn, apart from the work and the reply', () => {
    const items = resolveTimeline(
      [
        createCallEntry('1', shinsaTool('delegate_task', { task: 'Survey it' }), 1),
        createNoticeEntry({ kind: 'delegation', event: 'started', runIds: ['child'] }, 2, 'spawn'),
        createNoticeEntry({ kind: 'delegation', event: 'reported', runIds: ['child'] }, 3, 'report'),
        createAgentEntry('Done', 'final', 4),
      ],
      []
    );
    const [turn] = resolveTurns(items, finished, 500);
    expect(turn?.notices).toEqual([
      { kind: 'delegation', key: 'spawn', at: 2, event: 'started', runIds: ['child'] },
      { kind: 'delegation', key: 'report', at: 3, event: 'reported', runIds: ['child'] },
    ]);
    expect(turn?.work.map((item) => item.kind)).toEqual(['tools']);
    expect(turn?.reply?.text).toBe('Done');
  });

  it('splits the run into turns at each of your messages', () => {
    const items = resolveTimeline(
      [
        createBrief('Build it', 1),
        createAgentEntry('Done the first part', 'final', 10),
        createAgentEntry('Done the second part', 'final', 30),
      ],
      [{ at: 20, text: 'Now the second part' }]
    );
    const turns = resolveTurns(items, finished, 500);
    expect(turns).toHaveLength(2);
    expect(turns[0]?.human).toBeNull();
    expect(turns[0]?.key).toBe('turn-0');
    expect(turns[0]?.reply?.text).toBe('Done the first part');
    expect([turns[0]?.startedAt, turns[0]?.endedAt]).toEqual([1, 20]);
    expect(turns[1]?.human?.text).toBe('Now the second part');
    expect(turns[1]?.key).toBe(turns[1]?.human?.key);
    expect(turns[1]?.reply?.text).toBe('Done the second part');
    expect([turns[1]?.startedAt, turns[1]?.endedAt]).toEqual([20, 100]);
  });

  it('folds the brief, interim words and tool calls into the work, leaving the final reply out', () => {
    const items = resolveTimeline(
      [
        createBrief('Build it', 1),
        createAgentEntry('Reading', 'interim', 2),
        createCallEntry('1', readTool('a.ts'), 3),
        createCallEntry('2', readTool('b.ts'), 4),
        createCallEntry('3', shinsaTool('complete_phase', {}), 5),
        createAgentEntry('All done', 'final', 6),
      ],
      []
    );
    const [turn] = resolveTurns(items, finished, 500);
    expect(turn?.work.map((item) => item.kind)).toEqual(['instructions', 'agent', 'tools']);
    expect(turn?.outcomes.map((item) => item.call.tool.kind)).toEqual(['shinsa']);
    expect(turn?.reply?.text).toBe('All done');
    expect(turn?.steps).toBe(3);
    expect(turn?.live).toBe(false);
  });

  it('falls back to the last interim words when a finished turn has no final reply', () => {
    const items = resolveTimeline(
      [
        createAgentEntry('Checking', 'interim', 1),
        createAgentEntry('Looks right', 'interim', 2),
        createCallEntry('1', readTool('a.ts'), 3),
      ],
      []
    );
    const [turn] = resolveTurns(items, finished, 500);
    expect(turn?.reply?.text).toBe('Looks right');
    expect(turn?.work.map((item) => item.kind)).toEqual(['agent', 'tools']);
  });

  it('shows no reply for a live turn until the agent writes a final one', () => {
    const items = resolveTimeline([createAgentEntry('Checking', 'interim', 1)], []);
    const [turn] = resolveTurns(items, running, 500);
    expect(turn?.live).toBe(true);
    expect(turn?.reply).toBeNull();
    expect(turn?.endedAt).toBe(500);
  });

  it('shows no fallback reply for a failed run or a turn that ended in an error', () => {
    const items = resolveTimeline([createAgentEntry('Trying', 'interim', 1)], []);
    const failed = createRun({ id: 'r', taskId: 't', startedAt: 0, endedAt: 50, outcome: 'failed' });
    expect(resolveTurns(items, failed, 500)[0]?.reply).toBeNull();

    const errored = resolveTimeline(
      [createAgentEntry('Trying', 'interim', 1), createErrorEntry('Session failed', 2)],
      []
    );
    const [turn] = resolveTurns(errored, finished, 500);
    expect(turn?.reply).toBeNull();
    expect(turn?.errors.map((item) => item.text)).toEqual(['Session failed']);
    expect(turn?.work.map((item) => item.kind)).toEqual(['agent']);
  });

  it('keeps a final reply even when the run failed afterwards', () => {
    const items = resolveTimeline([createAgentEntry('Here is what I found', 'final', 1)], []);
    const failed = createRun({ id: 'r', taskId: 't', startedAt: 0, endedAt: 50, outcome: 'failed' });
    expect(resolveTurns(items, failed, 500)[0]?.reply?.text).toBe('Here is what I found');
  });

  it('opens one empty live turn for a run that has only just started, timed from the run', () => {
    const turns = resolveTurns([], running, 500);
    expect(turns).toHaveLength(1);
    expect(turns[0]).toMatchObject({
      key: 'turn-0',
      live: true,
      work: [],
      steps: 0,
      startedAt: 0,
      endedAt: 500,
    });
  });

  it('has no turns for a finished run with an empty transcript', () => {
    expect(resolveTurns([], finished, 500)).toEqual([]);
  });

  it('makes only the last turn live, starting at your message', () => {
    const items = resolveTimeline([createAgentEntry('First', 'final', 10)], [{ at: 20, text: 'Next' }]);
    const turns = resolveTurns(items, running, 500);
    expect(turns.map((turn) => turn.live)).toEqual([false, true]);
    expect(turns[1]?.work).toEqual([]);
    expect([turns[1]?.startedAt, turns[1]?.endedAt]).toEqual([20, 500]);
  });

  it('ends a finished turn at its last item when that is later than the run end', () => {
    const items = resolveTimeline([createAgentEntry('Late', 'final', 300)], []);
    expect(resolveTurns(items, finished, 500)[0]?.endedAt).toBe(300);
  });

  it('uses the current time when it is not given', () => {
    const before = Date.now();
    const [turn] = resolveTurns([], running);
    expect(turn?.endedAt).toBeGreaterThanOrEqual(before);
  });
});

describe('resolveLastHandover', () => {
  it('returns the arguments of the latest call to that Shinsa tool', () => {
    const entries = [
      createCallEntry('1', shinsaTool('propose_plan', { plan: ['old'] }), 1),
      createCallEntry('2', shinsaTool('propose_plan', { plan: ['new'] }), 2),
      createCallEntry('3', shinsaTool('note', { note: 'x' }), 3),
      createCallEntry('4', readTool('a.ts'), 4),
      createAgentEntry('done', 'final', 5),
    ];
    expect(resolveLastHandover(entries, 'propose_plan')).toEqual({ plan: ['new'] });
  });

  it('is null when the tool was never called', () => {
    expect(resolveLastHandover([createCallEntry('1', readTool('a.ts'), 1)], 'report_review')).toBeNull();
  });
});

describe('resolveLastAgentText', () => {
  it('prefers the latest final reply or error over later interim words', () => {
    expect(
      resolveLastAgentText([
        createAgentEntry('Answer', 'final', 1),
        createAgentEntry('Still checking', 'interim', 2),
      ])
    ).toBe('Answer');
    expect(
      resolveLastAgentText([createAgentEntry('Answer', 'final', 1), createErrorEntry('Session failed', 2)])
    ).toBe('Session failed');
  });

  it('falls back to the latest interim words', () => {
    expect(
      resolveLastAgentText([createAgentEntry('One', 'interim', 1), createAgentEntry('Two', 'interim', 2)])
    ).toBe('Two');
  });

  it('is null when the agent has said nothing', () => {
    expect(
      resolveLastAgentText([createBrief('Build', 1), createCallEntry('1', readTool('a.ts'), 2)])
    ).toBeNull();
  });
});
