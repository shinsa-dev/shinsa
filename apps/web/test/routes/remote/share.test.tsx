import { afterEach, describe, expect, it, mock, spyOn } from 'bun:test';
import type { ShareLiveView, Task } from '@shinsa/core';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { READ_ONLY_REFUSAL, selectReadOnlyRefusal } from '@/lib/connection/read-only.ts';
import { SharePage } from '@/routes/remote/share.tsx';
import { createSharedTask, DIFF } from '../../lib/share/fixtures.ts';
import { createFakeShareMachine, type FakeShareMachine, SHARE_LINK } from '../../lib/share/machine.ts';
import { createAgentEntry } from '../../support/chat.ts';
import { createTask } from '../../support/state.ts';

const ORIGINAL_SOCKET = globalThis.WebSocket;
const CODE_TAB_LOADED = { timeout: 5000 };
const blobs = new Map<string, Promise<string>>();

afterEach(() => {
  mock.restore();
  globalThis.WebSocket = ORIGINAL_SOCKET;
});

const REPORT = {
  headline: 'Rotating a key keeps the old one for a day.',
  sections: [{ title: 'Rotate keys', summary: 'Keeps the previous hash.', spots: [] }],
  checks: [],
  judgementCalls: [],
} as unknown as NonNullable<Task['report']>;

function liveView(overrides: Partial<ShareLiveView['shared']> = {}): ShareLiveView {
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
  return {
    shared: createSharedTask({ task, evidence: [], ...overrides }),
    files: { diff: { version: 'v1', type: 'text/plain' } },
    updatedAt: 1,
  };
}

function connect(session: Response | null = null) {
  const machine = createFakeShareMachine();
  globalThis.WebSocket = Object.assign(
    function createFakeSocket(url: string) {
      return machine.options.createSocket(url);
    },
    { OPEN: ORIGINAL_SOCKET.OPEN }
  ) as unknown as typeof WebSocket;
  spyOn(URL, 'createObjectURL').mockImplementation(((blob: Blob) => {
    const url = `blob:test-${crypto.randomUUID()}`;
    blobs.set(url, blob.text());
    return url;
  }) as never);
  spyOn(globalThis, 'fetch').mockImplementation(((input: string) => {
    if (input === '/__remote/session') return Promise.resolve(session ?? new Response('', { status: 401 }));
    if (input.startsWith('blob:'))
      return (blobs.get(input) ?? Promise.resolve('')).then((text) => new Response(text));
    return machine.options.fetch(input);
  }) as never);
  return machine;
}

async function sendFile(machine: FakeShareMachine, id: string, text: string) {
  const received = blobs.size;
  await machine.sendFile(id, 'v1', 'text/plain', text);
  await waitFor(() => expect(blobs.size).toBeGreaterThan(received));
}

async function open(machine: FakeShareMachine, view = liveView()) {
  render(<SharePage link={SHARE_LINK} />);
  await machine.ready;
  await machine.sendView(view);
  if (view.files.diff) await sendFile(machine, 'diff', DIFF);
  expect(await screen.findByText(view.shared.task.title)).toBeTruthy();
}

describe('the shared page on app.shinsa.dev', () => {
  it('refuses every write while it is open, and stops refusing once it closes', async () => {
    const machine = connect();
    render(<SharePage link={SHARE_LINK} />);
    await machine.ready;
    await machine.sendView(liveView());
    expect(await screen.findByText('Rotate API keys')).toBeTruthy();
    expect(selectReadOnlyRefusal()?.message).toBe(READ_ONLY_REFUSAL);
    document.body.innerHTML = '';
  });

  it('shows a task read-only, with who shared it and its code from the streamed diff', async () => {
    const machine = connect();
    const view = liveView();
    view.shared = { ...view.shared, task: { ...view.shared.task, id: 'task-diff' } };
    await open(machine, view);
    expect(screen.getByText('Read-only')).toBeTruthy();
    expect(screen.getByText('Shared by @mona from Studio')).toBeTruthy();
    expect(screen.getByText('app')).toBeTruthy();
    expect(screen.getAllByText('Summary').length).toBeGreaterThan(0);
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Task actions' })).toBeNull();
    expect(screen.getByRole('tab', { name: 'Chat' })).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Code' }));
    expect((await screen.findAllByText(/keys\.ts/, undefined, CODE_TAB_LOADED)).length).toBeGreaterThan(0);
  });

  it('opens a changed file whole from the streamed code', async () => {
    const machine = connect();
    const view = liveView();
    view.shared = { ...view.shared, task: { ...view.shared.task, id: 'task-whole' } };
    view.files = { ...view.files, code: { version: 'v1', type: 'text/plain' } };
    await open(machine, view);
    const whole = { files: { 'src/keys.ts': 'const ttl = 24;\nexport const keep = true;\n' } };
    await sendFile(machine, 'code', JSON.stringify(whole));
    fireEvent.click(screen.getByRole('tab', { name: 'Code' }));
    fireEvent.click((await screen.findAllByText(/keys\.ts/, undefined, CODE_TAB_LOADED))[0] as HTMLElement);
    expect((await screen.findAllByText(/const ttl = 24/)).length).toBeGreaterThan(0);
  });

  it('a Status link shows a small status card with its written description, and no request, plan, names, tabs or code', async () => {
    const machine = connect();
    const view = liveView({
      preset: 'status',
      owner: null,
      machine: null,
      repository: null,
      repo: null,
      project: null,
      code: false,
      runs: [],
      gates: [],
    });
    const task = view.shared.task;
    const plan = { version: 1, body: '', document: { goal: 'Keys rotate every week.', phases: [] } } as never;
    view.shared = {
      ...view.shared,
      description: 'Keys now rotate every week.',
      update: 'deploying',
      task: { ...task, request: 'Rotate the API keys weekly.', plan },
    };
    view.files = {};
    await open(machine, view);
    expect(screen.getByText('Status')).toBeTruthy();
    expect(screen.getAllByText('Deploying')).toHaveLength(2);
    expect(within(screen.getByRole('list', { name: 'Progress' })).getByText('Live')).toBeTruthy();
    expect(screen.getByText(/isn’t live yet/)).toBeTruthy();
    expect(screen.queryByText('Rotating a key keeps the old one for a day.')).toBeNull();
    expect(screen.getByText('Keys now rotate every week.')).toBeTruthy();
    expect(screen.queryByText('Keys rotate every week.')).toBeNull();
    expect(screen.queryByText('Rotate the API keys weekly.')).toBeNull();
    expect(screen.queryByRole('tab')).toBeNull();
    expect(screen.queryByText(/Shared by/)).toBeNull();
  });

  it('a Default link has a Chat tab with the agents’ streamed output and nothing to type in', async () => {
    const machine = connect();
    const view = liveView({ preset: 'standard' });
    view.shared = { ...view.shared, task: { ...view.shared.task, id: 'task-everything' } };
    view.files = { ...view.files, 'transcript-run-1-0': { version: '1', type: 'text/plain' } };
    await open(machine, view);
    const entry = { ...createAgentEntry('Rotating the keys now.', 'final', 2, 'e1') };
    await machine.sendFile('transcript-run-1-0', '1', 'text/plain', JSON.stringify([entry]));
    fireEvent.click(screen.getByRole('tab', { name: 'Chat' }));
    expect(await screen.findByText('Rotating the keys now.')).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('a task with no repository has no Code tab', async () => {
    const machine = connect();
    const view = liveView({ code: false, repository: null, repo: null });
    view.files = {};
    await open(machine, view);
    expect(screen.queryByText('app')).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Code' })).toBeNull();
  });

  it('says you shared it when you are signed in to app.shinsa.dev as its owner', async () => {
    const machine = connect(Response.json({ user: { id: '1', login: 'mona', avatarUrl: null } }));
    await open(machine);
    expect(await screen.findByText('Shared by you from Studio')).toBeTruthy();
  });

  it('follows the task live as the machine pushes it, and says so at once when sharing stops', async () => {
    const machine = connect();
    await open(machine);
    const view = liveView();
    await act(() =>
      machine.sendView({
        ...view,
        shared: { ...view.shared, task: { ...view.shared.task, title: 'Rotate every key' } },
        updatedAt: 2,
      })
    );
    expect(await screen.findByText('Rotate every key')).toBeTruthy();
    await act(() =>
      machine.send({ t: 'closed', reason: 'This task is no longer shared, or the link is wrong.' })
    );
    expect(await screen.findByText('This task is not shared')).toBeTruthy();
  });

  it('keeps showing the task while the machine is away for a moment', async () => {
    const machine = connect();
    await open(machine);
    await act(async () => {
      machine.latest().emit('close', {});
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(screen.getByText('Rotate API keys')).toBeTruthy();
    expect(screen.queryByText('The shared task did not load')).toBeNull();
  });

  it('says the task is not shared for a link without its key, and why it failed otherwise', async () => {
    const { unmount } = render(<SharePage link={null} />);
    expect(screen.getByText('This task is not shared')).toBeTruthy();
    unmount();
    const machine = connect();
    machine.online = false;
    render(<SharePage link={SHARE_LINK} />);
    await waitFor(() => expect(screen.getByText('The shared task did not load')).toBeTruthy());
  });
});
