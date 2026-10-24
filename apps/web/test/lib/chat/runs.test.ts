import { describe, expect, it } from 'bun:test';
import { describeEmptyChat, groupEvidenceByRun, listTaskRuns } from '@/lib/chat/runs.ts';
import { createEvidence, createRun, createShinsaState, createTask } from '../../support/state.ts';

describe('describeEmptyChat', () => {
  it('explains that Shinsa is still setting up a task in triage', () => {
    expect(describeEmptyChat(createTask({ id: 't', stage: 'triage' }))).toEqual({
      title: 'Shinsa is setting up the task',
      description: 'It picks the repository and a branch, then an agent starts here.',
    });
  });

  it('explains that a queued task waits on another task', () => {
    expect(describeEmptyChat(createTask({ id: 't', stage: 'waiting_on_tasks' })).title).toBe(
      'Not started yet'
    );
  });

  it('says no agent has run yet at any other stage', () => {
    expect(describeEmptyChat(createTask({ id: 't', stage: 'planning' }))).toEqual({
      title: 'No agent has run yet',
      description: 'The conversation shows up here once an agent picks up this task.',
    });
  });
});

describe('listTaskRuns', () => {
  it('lists only this task runs, oldest first', () => {
    const { runs } = createShinsaState({
      runs: [
        createRun({ id: 'late', taskId: 't', startedAt: 30 }),
        createRun({ id: 'other', taskId: 'u', startedAt: 10 }),
        createRun({ id: 'early', taskId: 't', startedAt: 20 }),
      ],
    });
    expect(listTaskRuns(runs, 't').map((run) => run.id)).toEqual(['early', 'late']);
    expect(listTaskRuns(runs, 'missing')).toEqual([]);
  });
});

describe('groupEvidenceByRun', () => {
  it('groups this task evidence by the run that attached it, skipping evidence without a run', () => {
    const { evidence } = createShinsaState({
      evidence: [
        createEvidence({ id: 'a', taskId: 't', runId: 'r1' }),
        createEvidence({ id: 'b', taskId: 't', runId: 'r2' }),
        createEvidence({ id: 'c', taskId: 't', runId: 'r1' }),
        createEvidence({ id: 'd', taskId: 't', runId: null }),
        createEvidence({ id: 'e', taskId: 'u', runId: 'r1' }),
      ],
    });
    const byRun = groupEvidenceByRun(evidence, 't');
    expect([...byRun.keys()]).toEqual(['r1', 'r2']);
    expect(byRun.get('r1')?.map((item) => item.id)).toEqual(['a', 'c']);
    expect(byRun.get('r2')?.map((item) => item.id)).toEqual(['b']);
  });
});
