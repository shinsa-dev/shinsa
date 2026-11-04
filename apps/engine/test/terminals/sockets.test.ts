import { afterEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { realpathSync, rmSync } from 'node:fs';
import type { ServerMessage, TerminalInfo, TerminalsSnapshot } from '@shinsa/core';
import { Effect } from 'effect';
import { createSocketHandlers } from '../../src/http/server/sockets.ts';
import type { TerminalSocketData } from '../../src/terminals/schema.ts';
import { createTerminalSockets } from '../../src/terminals/sockets.ts';
import {
  attachTerminal as attach,
  ORIGIN,
  openSocket,
  startTerminalServer as start,
  stopTerminalServers,
} from '../helpers/terminals.ts';
import { until } from '../helpers/until.ts';
import { createFakeViewer } from './fakes.ts';
import { createTerminals, run } from './harness.ts';

setDefaultTimeout(30_000);

afterEach(stopTerminalServers);

describe('terminals over HTTP and their socket', () => {
  test('a real shell: open it, type, resize, watch it exit, start it again and close it', async () => {
    const { base, post, projectId, repoPath, terminals } = await start();
    const created = await post('/api/terminals', {
      projectId,
      path: repoPath,
      command: 'echo "hi-$((6 * 7))"',
    });
    const { terminal } = (await created.json()) as { terminal: TerminalInfo };
    expect(terminal).toMatchObject({ projectId, cwd: repoPath, place: 'repository', status: 'running' });

    const view = attach(base, terminal.id);
    await view.opened;
    await until('the command ran', () => view.state.output.includes('hi-42'));
    expect(view.state.controls[0]).toMatchObject({ type: 'reset' });

    view.socket.send(JSON.stringify({ type: 'resize', cols: 132, rows: 43 }));
    view.socket.send(
      JSON.stringify({
        type: 'colors',
        colors: { foreground: '#000000', background: '#ffffff', cursor: '#0000ff' },
      })
    );
    view.socket.send('not a frame');
    view.socket.send(new TextEncoder().encode('stty size; pwd\r'));
    await until('the shell sees the new size', () => view.state.output.includes('43 132'));
    await until('the shell is in the folder', () => view.state.output.includes(realpathSync(repoPath)));

    view.socket.send(new TextEncoder().encode('exit 7\r'));
    await until('the exit is recorded', () => run(terminals.select(terminal.id))?.info.status === 'exited');
    expect(run(terminals.select(terminal.id))?.info.exitCode).toBe(7);

    const again = attach(base, terminal.id);
    await again.opened;
    await until('a second viewer sees the old output', () => again.state.output.includes('hi-42'));
    again.socket.close();
    view.socket.send('{"type":"clear"}');

    const restarted = (await (
      await post(`/api/terminals/${terminal.id}/restart`, {})
    ).json()) as TerminalsSnapshot;
    expect(restarted.terminals[0]?.status).toBe('running');
    view.socket.send(new TextEncoder().encode('echo back\r'));
    await until('the new shell answers', () => view.state.output.includes('back'));

    const closed = (await (
      await post(`/api/terminals/${terminal.id}/close`, {})
    ).json()) as TerminalsSnapshot;
    expect(closed.terminals).toEqual([]);
    await until('the viewer is told', () => view.state.closed === 4404);
  });

  test('names, orders and lists terminals, and pushes every change to the page’s socket', async () => {
    const { base, post, projectId, repoPath } = await start();
    const hub = openSocket(`${base.replace('http', 'ws')}/ws`, ORIGIN);
    const messages: ServerMessage[] = [];
    hub.addEventListener('message', (event) =>
      messages.push(JSON.parse(String(event.data)) as ServerMessage)
    );
    await until('the first snapshot', () => messages.some((message) => message.type === 'terminals'));
    const first = (
      (await (await post('/api/terminals', { projectId, path: repoPath })).json()) as {
        terminal: TerminalInfo;
      }
    ).terminal;
    const second = (
      (await (await post('/api/terminals', { projectId, path: repoPath })).json()) as {
        terminal: TerminalInfo;
      }
    ).terminal;
    await post(`/api/terminals/${first.id}/rename`, { name: 'Server' });
    await post('/api/terminals/order', { projectId, ids: [second.id, first.id, 7] });
    const listed = (await (await fetch(`${base}/api/terminals`)).json()) as TerminalsSnapshot;
    expect(listed.terminals.map((each) => [each.id, each.name])).toEqual([
      [second.id, null],
      [first.id, 'Server'],
    ]);
    await until('the socket has the order', () => {
      const last = messages.filter((message) => message.type === 'terminals').at(-1);
      return last?.type === 'terminals' && last.terminals.terminals[0]?.id === second.id;
    });
    await post(`/api/terminals/${first.id}/rename`, { name: null });
    hub.close();
  });

  test('refuses a folder outside the project, a missing one, a page from another site and any program', async () => {
    const { base, post, projectId, repoPath, terminals } = await start();
    expect(await (await post('/api/terminals', { projectId, path: '/etc' })).json()).toMatchObject({
      error: { code: 'terminal_place_invalid' },
    });
    expect(await (await post('/api/terminals', { projectId: 'nope', path: repoPath })).json()).toMatchObject({
      error: { code: 'project_not_found' },
    });
    expect(await (await post('/api/terminals', { projectId, path: '' })).json()).toMatchObject({
      error: { code: 'body_invalid' },
    });
    expect((await post('/api/terminals', { projectId, path: repoPath }, null)).status).toBe(400);
    expect((await post('/api/terminals', { projectId, path: repoPath }, 'https://evil.example')).status).toBe(
      403
    );
    rmSync(repoPath, { recursive: true });
    expect(await (await post('/api/terminals', { projectId, path: repoPath })).json()).toMatchObject({
      error: { code: 'terminal_place_missing' },
    });
    expect(run(terminals.snapshot).terminals).toEqual([]);
    await expect(attach(base, 'some-id', null).opened).rejects.toThrow('socket refused');
    const unknown = attach(base, 'some-id');
    await unknown.opened;
    await until('a closed terminal is refused', () => unknown.state.closed === 4404);
    expect((await fetch(`${base}/ws/terminals/bad.id`)).status).not.toBe(101);
  });

  test('ignores messages and drains for a terminal closed under its socket', async () => {
    const { base, post, projectId, repoPath, terminals } = await start();
    const { terminal } = (await (await post('/api/terminals', { projectId, path: repoPath })).json()) as {
      terminal: TerminalInfo;
    };
    const view = attach(base, terminal.id);
    await view.opened;
    await until('the screen arrives', () => view.state.controls.length > 0);
    const session = run(terminals.find(terminal.id));
    terminals.select = () => Effect.succeed(null);
    view.socket.send('{"type":"resize","cols":90,"rows":20}');
    view.socket.close();
    await until('the socket closes', () => view.state.closed !== null);
    expect(session.viewers).toBe(1);
  });
});

describe('createTerminalSockets', () => {
  test('a socket that drains catches up with the screen, and one without a viewer is skipped', () => {
    const { terminals, fake } = createTerminals();
    const terminal = run(terminals.create({ projectId: 'p1', cwd: '/tmp', place: 'folder', taskId: null }));
    const sockets = run(createTerminalSockets(terminals));
    const viewer = createFakeViewer();
    run(terminals.attach(terminal.id, viewer));
    viewer.bufferedBytes = Number.MAX_SAFE_INTEGER;
    fake.spawned[0]?.emit('x'.repeat(300_000));
    viewer.bufferedBytes = 0;
    const data: TerminalSocketData = { kind: 'terminal', terminalId: terminal.id, viewer };
    const handlers = createSocketHandlers(
      { open: () => undefined, close: () => undefined, message: () => undefined },
      sockets
    );
    handlers.drain({ data } as unknown as Parameters<typeof handlers.drain>[0]);
    handlers.drain({ data: { kind: 'hub' } } as unknown as Parameters<typeof handlers.drain>[0]);
    expect(viewer.controls()).toHaveLength(4);
    sockets.drain({ data: { ...data, viewer: null } } as unknown as Parameters<typeof sockets.drain>[0]);
    expect(viewer.controls()).toHaveLength(4);
  });
});
