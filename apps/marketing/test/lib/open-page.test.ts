import { describe, expect, test } from 'bun:test';
import { deflateRawSync } from 'node:zlib';
import { openTask } from '../../src/lib/content';
import { readOpenPage } from '../../src/lib/open-page';
import { OPEN_TASK_ID } from '../../src/lib/open-scene';

function encode(value: unknown) {
  return deflateRawSync(Buffer.from(JSON.stringify(value))).toString('base64url');
}

const review = {
  v: 1,
  task: {
    id: 'task-1',
    handle: 'LOC-44',
    title: 'Render the open page at once',
    summary: 'One paint.',
    pullRequest: 34,
    repo: null,
    slug: null,
    branch: null,
    coverage: null,
    stage: 'shipping',
    startedAt: 500,
  },
  report: { headline: 'H', sections: [], checks: [], judgementCalls: [], walkthrough: null },
  evidence: [],
  review: null,
};

describe('readOpenPage', () => {
  test('builds the whole review page from the fragment, with the task link from the query', async () => {
    const page = await readOpenPage('?task=id-1&handle=LOC-44', `#review=${encode(review)}`, 1_000);
    if (!('scene' in page)) throw new Error('expected a review page');
    expect(page.scene.link).toBe('shinsa://task/id-1');
    expect(page.scene.payload.task.title).toBe('Render the open page at once');
    expect(page.scene.task).toMatchObject({ id: OPEN_TASK_ID, title: 'Render the open page at once' });
    expect(page.scene.state.tasks[OPEN_TASK_ID]).toBe(page.scene.task);
  });

  test('keeps the review page without a task link when the query names no task', async () => {
    const page = await readOpenPage('', `#review=${encode(review)}`, 1_000);
    if (!('scene' in page)) throw new Error('expected a review page');
    expect(page.scene.link).toBeNull();
  });

  test('falls back to the invite header when the link carries no review', async () => {
    expect(await readOpenPage('?task=id-1&handle=LOC-44&title=Fix+tabs', '', 1_000)).toEqual({
      header: {
        title: 'Fix tabs',
        description: '',
        handle: 'LOC-44',
        link: 'shinsa://task/id-1',
      },
    });
    expect(await readOpenPage('', '#review=AAAA', 1_000)).toMatchObject({
      header: { title: openTask.missingTitle, link: null },
    });
  });
});
