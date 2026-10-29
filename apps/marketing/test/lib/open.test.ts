import { describe, expect, test } from 'bun:test';
import { deflateRawSync } from 'node:zlib';
import { describePullRequestEyebrow, readReviewFragment, resolveTaskInvite } from '../../src/lib/open';

function encode(value: unknown) {
  return deflateRawSync(Buffer.from(JSON.stringify(value))).toString('base64url');
}

describe('resolveTaskInvite', () => {
  test('turns the task in the query into a link the Mac app opens, with its handle and title', () => {
    expect(
      resolveTaskInvite('?task=01a1880f-a4df-73bb-b4bf-ecbc86bea168&handle=LOC-28&title=Fix+the++tabs%0A')
    ).toEqual({
      link: 'shinsa://task/01a1880f-a4df-73bb-b4bf-ecbc86bea168',
      handle: 'LOC-28',
      title: 'Fix the tabs',
    });
  });

  test('drops a handle that is not one and an empty title, and cuts a long title', () => {
    expect(resolveTaskInvite('?task=id-1&handle=<b>x</b>&title=%20')).toEqual({
      link: 'shinsa://task/id-1',
      handle: null,
      title: null,
    });
    expect(resolveTaskInvite(`?task=id-1&title=${'t'.repeat(300)}`)?.title).toHaveLength(120);
  });

  test('refuses a missing, empty or unsafe task', () => {
    expect(resolveTaskInvite('')).toBeNull();
    expect(resolveTaskInvite('?task=')).toBeNull();
    expect(resolveTaskInvite('?task=../settings')).toBeNull();
    expect(resolveTaskInvite('?task=javascript:alert(1)')).toBeNull();
    expect(resolveTaskInvite(`?task=${'a'.repeat(65)}`)).toBeNull();
  });
});

describe('readReviewFragment', () => {
  const review = {
    v: 1,
    task: {
      id: 'task-1',
      handle: 'LOC-28',
      title: 'Fix the tabs',
      summary: 'Tabs stay put.',
      pullRequest: 23,
      repo: null,
      slug: null,
      branch: null,
      coverage: null,
    },
    report: { headline: 'H', sections: [], checks: [], judgementCalls: [], walkthrough: null },
    evidence: [],
    review: null,
  };

  test('reads the review the pull request link carries in its fragment', async () => {
    expect(await readReviewFragment(`#review=${encode(review)}`)).toEqual({ ...review, v: 1 });
  });

  test('reads nothing from a missing, malformed or foreign fragment', async () => {
    expect(await readReviewFragment('')).toBeNull();
    expect(await readReviewFragment('#review=not+base64')).toBeNull();
    expect(await readReviewFragment('#review=AAAA')).toBeNull();
    expect(await readReviewFragment(`#review=${encode({ v: 9 })}`)).toBeNull();
  });
});

describe('describePullRequestEyebrow', () => {
  test('names the pull request by its number when it has one', () => {
    expect(describePullRequestEyebrow(23)).toBe('Pull request #23');
    expect(describePullRequestEyebrow(null)).toBe('Pull request');
  });
});
