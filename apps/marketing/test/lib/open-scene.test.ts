import { describe, expect, test } from 'bun:test';
import { createOpenState, OPEN_REPO_ID, OPEN_TASK_ID } from '../../src/lib/open-scene';

describe('createOpenState', () => {
  test('builds the task the Review tab shows from the review the link carries', () => {
    const { state, task } = createOpenState(
      {
        v: 1,
        task: {
          id: 'task-1',
          handle: 'LOC-28',
          title: 'Fix the tabs',
          summary: 'Tabs stay put.',
          pullRequest: 23,
          repo: 'shinsa',
          slug: 'shinsa-dev/shinsa',
          branch: 'feat/tabs',
          coverage: { covered: 46, executable: 48 },
          stage: 'awaiting_merge',
          startedAt: 500,
        },
        report: {
          headline: 'Clamp the width.',
          sections: [],
          checks: [
            { id: 'c1', label: 'Tests', command: 'bun test', outcome: 'pass', detail: null },
            { id: 'r1', label: 'bun lint', command: 'bun lint', outcome: 'pass', detail: null },
          ],
          judgementCalls: [],
          walkthrough: null,
        },
        evidence: [
          {
            id: 'b',
            itemId: 'tabs',
            kind: 'screenshot',
            title: 'Tabs',
            url: 'https://github.com/user-attachments/assets/b',
            detail: 'Scrolls.',
            width: 1280,
            theme: 'dark',
            stage: 'before',
            label: 'Old',
          },
          {
            id: 'a',
            itemId: 'tabs',
            kind: 'screenshot',
            title: 'Tabs',
            url: 'https://github.com/user-attachments/assets/a',
            detail: null,
            width: null,
            theme: null,
            stage: null,
            label: null,
          },
        ],
        review: null,
      },
      1_000
    );
    expect(task).toMatchObject({
      id: OPEN_TASK_ID,
      handle: 'LOC-28',
      title: 'Fix the tabs',
      summary: 'Tabs stay put.',
      checkResults: [{ id: 'c1' }, { id: 'r1' }],
    });
    expect(state.tasks[OPEN_TASK_ID]).toBe(task);
    expect(task.checks?.map((check) => [check.id, check.source])).toEqual([
      ['c1', 'plan'],
      ['r1', 'repo'],
    ]);
    expect(task).toMatchObject({
      repoId: OPEN_REPO_ID,
      branch: 'feat/tabs',
      stage: 'awaiting_merge',
      createdAt: 500,
      coverage: { status: 'measured', covered: 46, executable: 48 },
      pullRequest: { number: 23, url: 'https://github.com/shinsa-dev/shinsa/pull/23', state: 'open' },
    });
    expect(state.repos[OPEN_REPO_ID]).toMatchObject({
      name: 'shinsa',
      path: 'shinsa-dev/shinsa',
      remote: 'github.com/shinsa-dev/shinsa',
    });
    expect(state.evidence.b).toMatchObject({
      taskId: OPEN_TASK_ID,
      uri: 'https://github.com/user-attachments/assets/b',
      itemId: 'tabs',
      detail: 'Scrolls.',
      width: 1280,
      theme: 'dark',
      stage: 'before',
      label: 'Old',
      attachedAt: 998,
    });
    expect(state.evidence.a).not.toHaveProperty('stage');
    expect(task.pipeline).not.toContain('agent_review');
    expect(task).toMatchObject({ reviewSummary: null, findings: [] });
  });

  test('shows the agent review only when the link carries what it found', () => {
    const finding = { severity: 'suggestion' as const, file: null, line: null, message: 'Name the map.' };
    const { task } = createOpenState(
      {
        v: 1,
        task: {
          id: 'task-1',
          handle: null,
          title: 'Fix',
          summary: null,
          pullRequest: null,
          repo: null,
          slug: null,
          branch: null,
          coverage: null,
          stage: 'shipping',
          startedAt: null,
        },
        report: { headline: 'H', sections: [], checks: [], judgementCalls: [], walkthrough: null },
        evidence: [],
        review: { summary: 'Looks right.', findings: [finding] },
      },
      1_000
    );
    expect(task.pipeline).toContain('agent_review');
    expect(task).toMatchObject({ repoId: null, pullRequest: null, coverage: null, createdAt: 1_000 });
    expect(task).toMatchObject({ reviewSummary: 'Looks right.', findings: [finding] });
  });
});
