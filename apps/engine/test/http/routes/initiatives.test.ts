import { afterEach, describe, expect, test } from 'bun:test';
import { disposeWebHandlers } from '../../helpers/web.ts';
import { startRoutes } from './harness.ts';

afterEach(disposeWebHandlers);

async function start() {
  const { context, base, send } = startRoutes();
  const { engine } = context;
  const read = async (path: string) => {
    const response = await send(path);
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  };
  await engine.dispatch({ type: 'task.create', request: 'Rewrite the dock', repoId: null, backlog: true });
  const [dockId = ''] = Object.keys(engine.state.tasks);
  await engine.dispatch({
    type: 'task.create',
    request: 'Port the studio chat',
    repoId: null,
    backlog: true,
  });
  const studioId = Object.keys(engine.state.tasks).find((id) => id !== dockId) ?? '';
  await engine.dispatch({ type: 'task.create', request: 'Old guided builder', repoId: null });
  const oldId = Object.keys(engine.state.tasks).find((id) => id !== dockId && id !== studioId) ?? '';
  await engine.dispatch({
    type: 'task.create',
    request: 'Chat split\nRestart the chat stack as small pull requests.',
    repoId: null,
    initiative: true,
  });
  const created = Object.values(engine.state.initiatives)[0];
  await engine.dispatch({
    type: 'initiative.write',
    initiativeId: created?.id ?? '',
    name: 'Chat split',
    phases: [
      { id: null, name: 'Dock' },
      { id: null, name: 'Studio' },
    ],
  });
  const initiative = Object.values(engine.state.initiatives)[0];
  const [dock, studio] = initiative?.phases ?? [];
  const initiativeId = initiative?.id ?? '';
  await engine.dispatch({
    type: 'task.join_initiative',
    taskId: dockId,
    initiativeId,
    phaseId: dock?.id ?? null,
  });
  await engine.dispatch({
    type: 'task.join_initiative',
    taskId: studioId,
    initiativeId,
    phaseId: studio?.id ?? null,
  });
  await engine.dispatch({ type: 'task.join_initiative', taskId: oldId, initiativeId, phaseId: null });
  await engine.dispatch({ type: 'task.cancel', taskId: oldId });
  return { engine, base, read, initiativeId, dockId, studioId, oldId };
}

describe('GET /api/initiatives', () => {
  test('lists every initiative with its phases, member count, progress and link', async () => {
    const { engine, read, base, initiativeId } = await start();
    const { status, body } = await read('/api/initiatives');
    expect(status).toBe(200);
    expect(body).toMatchObject({
      initiatives: [
        {
          id: initiativeId,
          name: 'Chat split',
          description: 'Restart the chat stack as small pull requests.',
          phases: [{ name: 'Dock' }, { name: 'Studio' }],
          lead: { title: 'Chat split' },
          members: 3,
          progress: [
            { phase: { name: 'Dock' }, total: 1, shipped: 0, dropped: 0 },
            { phase: { name: 'Studio' }, total: 1, shipped: 0, dropped: 0 },
            { phase: null, total: 1, shipped: 0, dropped: 1 },
          ],
          url: `${base}/tasks/${engine.state.initiatives[initiativeId]?.leadTaskId}`,
        },
      ],
    });
  });
});

describe('GET /api/initiatives/<ref>', () => {
  test('reads the sheet by name: next in phase order, and what was dropped with its reason', async () => {
    const { read, dockId, studioId, oldId } = await start();
    const { status, body } = await read('/api/initiatives/chat%20split');
    expect(status).toBe(200);
    expect(body).toMatchObject({
      initiative: { name: 'Chat split', members: 3 },
      needsYou: [],
      now: [],
      shipped: [],
      next: [
        { phase: { name: 'Dock' }, tasks: [{ task: { id: dockId }, waitsOn: [] }] },
        { phase: { name: 'Studio' }, tasks: [{ task: { id: studioId }, waitsOn: [] }] },
      ],
      dropped: [{ task: { id: oldId }, reason: expect.any(String) }],
      decisions: [],
    });
  });

  test('refuses an initiative that does not exist', async () => {
    const { read } = await start();
    const { status, body } = await read('/api/initiatives/billing');
    expect(status).toBeGreaterThanOrEqual(400);
    expect(body).toEqual({
      error: {
        code: 'initiative_not_found',
        message: 'No initiative billing. `shinsa initiatives list` lists them.',
      },
    });
  });
});
