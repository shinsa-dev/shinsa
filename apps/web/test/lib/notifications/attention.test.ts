import { describe, expect, it } from 'bun:test';
import { serializeReportMarkdown } from '@shinsa/core';
import {
  describeDecision,
  listNewDecisions,
  listOpenGateIds,
  resolvePageAttention,
  resolveWindowTitle,
} from '@/lib/notifications/attention.ts';
import {
  createGate,
  createProject,
  createRepo,
  createShinsaState,
  createTask,
  NOW,
} from '../../support/state.ts';

const question = createGate({
  id: 'g-question',
  taskId: 't-1',
  type: 'question',
  title: 'Which colour should the button be?',
});

function withTasks(...gates: ReturnType<typeof createGate>[]) {
  return createShinsaState({
    tasks: [
      createTask({ id: 't-1', title: 'Paint the button', stage: 'building', repoId: 'r-1' }),
      createTask({ id: 't-2', title: 'Ship the fix', stage: 'awaiting_review', repoId: 'r-2' }),
    ],
    gates,
    repos: [createRepo({ id: 'r-1', projectId: 'a-1' }), createRepo({ id: 'r-2', projectId: 'a-2' })],
    projects: [createProject({ id: 'a-1' }), createProject({ id: 'a-2' })],
  });
}

describe('the page status and badge', () => {
  it('is idle with nothing going on, working while a task moves', () => {
    expect(resolvePageAttention(createShinsaState({}), NOW)).toEqual({ status: 'idle', badge: 0 });
    expect(resolvePageAttention(withTasks(), NOW)).toEqual({ status: 'working', badge: 0 });
  });

  it('waits on you with a decision up, and says failed when one is a failure', () => {
    const review = createGate({ id: 'g-review', taskId: 't-2' });
    expect(resolvePageAttention(withTasks(question, review), NOW)).toEqual({ status: 'waiting', badge: 2 });
    const failure = createGate({ id: 'g-fail', taskId: 't-2', type: 'failure' });
    expect(resolvePageAttention(withTasks(failure), NOW)).toEqual({ status: 'failed', badge: 1 });
    const signIn = createGate({ id: 'g-sign-in', taskId: 't-2', type: 'sign_in' });
    expect(resolvePageAttention(withTasks(signIn), NOW)).toEqual({ status: 'failed', badge: 1 });
  });

  it('counts only what the focus project lets through', () => {
    const review = createGate({ id: 'g-review', taskId: 't-2' });
    const state = { ...withTasks(question, review), focus: { projectId: 'a-1', until: null } };
    expect(resolvePageAttention(state, NOW).badge).toBe(1);
    expect(listOpenGateIds(state)).toEqual(new Set(['g-question', 'g-review']));
  });

  it('puts the count in front of the name', () => {
    expect(resolveWindowTitle(0)).toBe('Shinsa');
    expect(resolveWindowTitle(3)).toBe('[3] Shinsa');
  });
});

describe('what a notification says', () => {
  it('shows the pending question, or the reason and its detail, on one line under 180 characters', () => {
    const state = withTasks(question);
    const [entry] = listNewDecisions(new Set(), state, NOW);
    expect(entry).toEqual({
      gateId: 'g-question',
      taskId: 't-1',
      title: 'Paint the button',
      body: 'Which colour should the button be?',
    });
    const failure = createGate({
      id: 'g-fail',
      taskId: 't-1',
      type: 'failure',
      title: 'Out of automatic fix rounds',
      body: 'Two  files\nstill fail.',
    });
    expect(listNewDecisions(new Set(), withTasks(failure), NOW)[0]?.body).toMatch(
      /\. Two files still fail\.$/
    );
    const bare = createGate({ ...failure, id: 'g-bare', body: '  ' });
    expect(listNewDecisions(new Set(), withTasks(bare), NOW)[0]?.body).not.toMatch(/\.\s*$/);
  });

  it('shows a review as its plain headline, never the report’s markdown', () => {
    const body = serializeReportMarkdown({
      headline: 'Adds retries',
      sections: [{ title: 'Retry loop', summary: 'Wraps the call', spots: [] }],
      checks: [],
      judgementCalls: [],
    } as never);
    const task = createTask({
      id: 't',
      title: 'Retry the export',
      stage: 'awaiting_review',
      report: { headline: 'Adds retries' } as never,
    });
    const state = createShinsaState({ tasks: [task], gates: [createGate({ id: 'g', taskId: 't', body })] });
    expect(listNewDecisions(new Set(), state, NOW)[0]?.body).toBe(
      'Built, checked and ready for you. Adds retries'
    );
  });

  it('tells an operation waiting after the merge by its reason and the merge, without markdown or its steps', () => {
    const task = createTask({ id: 't', title: 'Backfill currencies', stage: 'awaiting_operation' });
    const gate = createGate({
      id: 'g',
      taskId: 't',
      type: 'operation',
      title: 'The change merged. Run the operation now?',
      body: 'Pull request #42 merged as `abc1234`.\n\n## Operation\n1. Run the backfill.\n\n## Impact\nAbout 400 rows.',
    });
    const state = createShinsaState({ tasks: [task], gates: [gate] });
    expect(listNewDecisions(new Set(), state, NOW)[0]?.body).toBe(
      'The change merged and the operation waits for your OK. Pull request #42 merged as abc1234.'
    );
  });

  it('never repeats a secret request, only names what was asked for', () => {
    const secret = {
      ...question,
      type: 'secret' as const,
      id: 'g-secret',
      title: 'For the webhook.',
      secret: { label: 'GitHub secret' },
    };
    expect(listNewDecisions(new Set(), withTasks(secret), NOW)[0]?.body).toBe('Asks for the GitHub secret.');
  });

  it('cuts a long body at a word boundary with an ellipsis', () => {
    const long = (body: string) =>
      listNewDecisions(
        new Set(),
        withTasks(createGate({ id: 'g-long', taskId: 't-1', type: 'failure', body })),
        NOW
      )[0]?.body ?? '';
    const cut = long(`${'word '.repeat(60)}end`);
    expect(cut.length).toBeLessThanOrEqual(180);
    expect(cut.endsWith('…')).toBe(true);
    expect(
      describeDecision({
        gate: question,
        task: createTask({ id: 't-1' }),
        projectId: null,
        unblocks: 0,
        reason: '',
      }).title
    ).toBe('Task t-1');
  });
});

describe('which decisions are new', () => {
  it('says nothing for the first snapshot after a load', () => {
    expect(listNewDecisions(null, withTasks(question), NOW)).toEqual([]);
  });

  it('names gates that just opened, and not ones already seen or outside the focus project', () => {
    const review = createGate({ id: 'g-review', taskId: 't-2' });
    const focused = { ...withTasks(question, review), focus: { projectId: 'a-1', until: null } };
    expect(listNewDecisions(new Set(), focused, NOW).map((entry) => entry.gateId)).toEqual(['g-question']);
    expect(listNewDecisions(new Set(['g-question']), focused, NOW)).toEqual([]);
  });
});
