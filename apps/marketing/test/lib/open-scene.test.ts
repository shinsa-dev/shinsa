import { describe, expect, test } from 'bun:test';
import { OPEN_TASK_ID } from '../../src/lib/demo-repo';
import { createOpenState } from '../../src/lib/open-scene';

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
        },
        report: {
          headline: 'Clamp the width.',
          sections: [],
          checks: [{ id: 'c1', label: 'Tests', command: 'bun test', outcome: 'pass', detail: null }],
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
      },
      1_000
    );
    expect(task).toMatchObject({
      id: OPEN_TASK_ID,
      handle: 'LOC-28',
      title: 'Fix the tabs',
      summary: 'Tabs stay put.',
      repoId: null,
      checkResults: [{ id: 'c1' }],
    });
    expect(state.tasks[OPEN_TASK_ID]).toBe(task);
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
  });
});
