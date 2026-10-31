import { afterEach, describe, expect, it, mock, spyOn } from 'bun:test';
import type { SharedPublication, Task } from '@shinsa/core';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { READ_ONLY_REFUSAL, selectReadOnlyRefusal } from '@/lib/connection/read-only.ts';
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
    repoId: 'repo-1',
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
  it('refuses every write while it is open, and stops refusing once it closes', async () => {
    serve({
      '/__remote/shares/tok': () => Response.json(publication()),
      '/__remote/shares/tok/files/diff': () => new Response(DIFF),
    });
    const page = render(<SharePage token='tok' />);
    expect(await screen.findByText('Rotate API keys')).toBeTruthy();
    expect(selectReadOnlyRefusal()?.message).toBe(READ_ONLY_REFUSAL);
    page.unmount();
    expect(selectReadOnlyRefusal()).toBeNull();
  });

  it('shows a task read-only, with who shared it and its code from the published diff', async () => {
    serve({
      '/__remote/shares/tok': () => Response.json(publication()),
      '/__remote/shares/tok/files/diff': () => new Response(DIFF),
    });
    render(<SharePage token='tok' />);
    expect(await screen.findByText('Rotate API keys')).toBeTruthy();
    expect(screen.getByText('Read-only')).toBeTruthy();
    expect(screen.getByText('Shared by @mona from Studio')).toBeTruthy();
    expect(screen.getByText('app')).toBeTruthy();
    expect(screen.getAllByText('Summary').length).toBeGreaterThan(0);
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Task actions' })).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Chat' })).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Code' }));
    expect((await screen.findAllByText(/keys\.ts/)).length).toBeGreaterThan(0);
  });

  it('shows where the task stands, what changed and its activity, like its owner’s overview', async () => {
    const shared = publication();
    shared.shared.task = {
      ...shared.shared.task,
      activity: [
        { at: 1, actor: 'agent', kind: 'work', text: 'Finished phase 1.', detail: null, evidenceId: null },
      ],
    };
    serve({ '/__remote/shares/tok': () => Response.json(shared) });
    render(<SharePage token='tok' />);
    expect(await screen.findByText('Rotate API keys')).toBeTruthy();
    expect(screen.getByText('What changed')).toBeTruthy();
    expect(screen.getByText('Rotate keys')).toBeTruthy();
    expect(screen.getByText('Activity')).toBeTruthy();
    expect(screen.getByText('Finished phase 1.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Read the review' }));
    expect(
      (await screen.findAllByText('Rotating a key keeps the old one for a day.')).length
    ).toBeGreaterThan(0);
  });

  it('a task with no repository has no Code tab', async () => {
    const shared = publication({ code: false, repository: null, repo: null });
    shared.files = [];
    serve({ '/__remote/shares/tok': () => Response.json(shared) });
    render(<SharePage token='tok' />);
    expect(await screen.findByText('Rotate API keys')).toBeTruthy();
    expect(screen.queryByText('app')).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Code' })).toBeNull();
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
