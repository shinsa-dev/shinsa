import { afterEach, describe, expect, it, mock, spyOn } from 'bun:test';
import type { SharedPublication, Task } from '@shinsa/core';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SharePage } from '@/routes/remote/share.tsx';
import { createSharedTask, DIFF } from '../../lib/share/fixtures.ts';
import { createTask } from '../../support/state.ts';

afterEach(() => {
  mock.restore();
});

const REPORT = {
  headline: 'Rotating a key keeps the old one for a day.',
  sections: [{ title: 'Rotate keys', summary: 'Keeps the previous hash.', spots: [] }],
  checks: [],
  judgementCalls: [],
} as unknown as NonNullable<Task['report']>;

function serve(routes: Record<string, () => Response>) {
  return spyOn(globalThis, 'fetch').mockImplementation(((input: string) => {
    const route = routes[String(input)];
    return Promise.resolve(route ? route() : new Response('', { status: 404 }));
  }) as never);
}

function refresh() {
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

function publication(overrides: Partial<SharedPublication['shared']> = {}): SharedPublication {
  const task = createTask({
    id: 'task-1',
    handle: 'SW-34',
    title: 'Rotate API keys',
    stage: 'awaiting_review',
    report: REPORT,
    summary: 'A rotated key keeps working for a day.',
    pullRequest: {
      number: 7,
      url: 'https://github.com/acme/app/pull/7',
      state: 'open',
      checks: 'passing',
      unresolvedComments: 0,
      mergeable: true,
      updatedAt: 1,
    },
  });
  return { shared: createSharedTask({ task, evidence: [], ...overrides }), files: ['diff'], updatedAt: 1 };
}

describe('the shared page on app.shinsa.dev', () => {
  it('shows a public task read-only, with who shared it and its code from the published diff', async () => {
    serve({
      '/__remote/shares/tok': () => Response.json(publication()),
      '/__remote/shares/tok/files/diff': () => new Response(DIFF),
    });
    render(<SharePage token='tok' />);
    expect(await screen.findByText('Rotate API keys')).toBeTruthy();
    expect(
      screen.getByText('Read-only. Only its owner can change this task, from their own Shinsa.')
    ).toBeTruthy();
    expect(screen.getByText('Shared by @mona from Studio')).toBeTruthy();
    expect(screen.getByText('acme/app')).toBeTruthy();
    expect(screen.getByText('A rotated key keeps working for a day.')).toBeTruthy();
    expect(screen.getByText('No plan yet. It shows here once the agent proposes one.')).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Code' }));
    expect(await screen.findByText('src/keys.ts')).toBeTruthy();
  });

  it('shows a private task without its repository, its code or a link to its pull request', async () => {
    const shared = publication({ code: false, repository: null });
    shared.files = [];
    const task = shared.shared.task;
    shared.shared.task = { ...task, pullRequest: task.pullRequest && { ...task.pullRequest, url: '' } };
    serve({ '/__remote/shares/tok': () => Response.json(shared) });
    render(<SharePage token='tok' />);
    expect(await screen.findByText('Rotate API keys')).toBeTruthy();
    expect(screen.queryByText('acme/app')).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Code' })).toBeNull();
    expect(screen.getByText('#7').closest('a')?.getAttribute('href')).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Review' }));
    expect(await screen.findByText('Rotating a key keeps the old one for a day.')).toBeTruthy();
  });

  it('says you shared it when you are signed in to app.shinsa.dev as its owner', async () => {
    serve({
      '/__remote/shares/tok': () => Response.json(publication()),
      '/__remote/session': () => Response.json({ user: { id: '1', login: 'mona', avatarUrl: null } }),
    });
    render(<SharePage token='tok' />);
    expect(await screen.findByText('Shared by you from Studio')).toBeTruthy();
  });

  it('follows the task as it changes, and says so at once when sharing stops', async () => {
    let current = publication();
    let shared = true;
    serve({
      '/__remote/shares/tok': () => (shared ? Response.json(current) : new Response('', { status: 404 })),
    });
    render(<SharePage token='tok' />);
    expect(await screen.findByText('Rotate API keys')).toBeTruthy();
    const task = { ...current.shared.task, title: 'Rotate every key' };
    current = { ...current, shared: { ...current.shared, task }, updatedAt: 2 };
    refresh();
    expect(await screen.findByText('Rotate every key')).toBeTruthy();
    refresh();
    expect(screen.getByText('Rotate every key')).toBeTruthy();
    shared = false;
    refresh();
    expect(await screen.findByText('This task is not shared')).toBeTruthy();
  });

  it('keeps showing the task when one refresh fails on the way', async () => {
    let up = true;
    const fetch = serve({
      '/__remote/shares/tok': () => (up ? Response.json(publication()) : new Response('', { status: 503 })),
    });
    const reads = () => fetch.mock.calls.filter(([url]) => url === '/__remote/shares/tok').length;
    render(<SharePage token='tok' />);
    expect(await screen.findByText('Rotate API keys')).toBeTruthy();
    up = false;
    refresh();
    await waitFor(() => expect(reads()).toBeGreaterThan(1));
    expect(screen.getByText('Rotate API keys')).toBeTruthy();
    expect(screen.queryByText('The shared task did not load')).toBeNull();
  });

  it('says the task is no longer shared when the link is gone, and why it failed otherwise', async () => {
    serve({});
    const { unmount } = render(<SharePage token='gone' />);
    expect(await screen.findByText('This task is not shared')).toBeTruthy();
    unmount();
    serve({ '/__remote/shares/down': () => new Response('', { status: 500 }) });
    render(<SharePage token='down' />);
    await waitFor(() => expect(screen.getByText('The shared task did not load')).toBeTruthy());
  });
});
