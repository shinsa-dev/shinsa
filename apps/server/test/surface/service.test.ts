import { describe, expect, test } from 'bun:test';
import { createServerInstance } from '../../src/instance/index.ts';
import type { ServiceControl, ServiceStatus } from '../../src/service/index.ts';
import { listAgentSpecs, SURFACE } from '../../src/surface/index.ts';
import { createFakeClient, runSpec } from './fixtures.ts';

const STATUS: ServiceStatus = {
  label: 'studio.overclock.shinsa',
  plist: '/Users/me/Library/LaunchAgents/studio.overclock.shinsa.plist',
  log: '/Users/me/.config/shinsa/data/serve.log',
  installed: true,
  loaded: true,
  state: 'running',
  pid: 4242,
  lastExitCode: null,
  server: {
    ...createServerInstance('f'.repeat(40), 1),
    pid: 4242,
    port: 5180,
    url: 'http://127.0.0.1:5180',
    bootedAt: 1,
    service: true,
  },
};

function createService(overrides: Partial<ServiceControl> = {}): ServiceControl {
  return {
    install: () =>
      Promise.resolve({
        label: STATUS.label,
        plist: STATUS.plist,
        log: STATUS.log,
        program: ['/bin/bun', '/src/shinsa/apps/server/src/main.ts', 'serve'],
        replaced: false,
        running: null,
      }),
    uninstall: () => Promise.resolve({ plist: STATUS.plist, wasLoaded: true, removedPlist: true }),
    status: () => Promise.resolve(STATUS),
    restart: () => Promise.resolve(STATUS),
    logs: (lines) => ({ path: STATUS.log, lines: ['one', 'two', String(lines)] }),
    ...overrides,
  };
}

function createServiceClient(service: ServiceControl) {
  const fake = createFakeClient();
  fake.client.service = service;
  return fake;
}

describe('shinsa service', () => {
  test('is yours alone: no agent has it as a tool', () => {
    const specs = SURFACE.filter((spec) => spec.path[0] === 'service');
    expect(specs.map((spec) => spec.path[1])).toEqual(['install', 'uninstall', 'status', 'restart', 'logs']);
    expect(specs.every((spec) => spec.humanOnly)).toBe(true);
    expect(listAgentSpecs().some((spec) => spec.path[0] === 'service')).toBe(false);
  });

  test('needs the command line: a client without the service refuses', async () => {
    await expect(runSpec(createFakeClient(), ['service', 'status'])).rejects.toThrow(
      'Only the `shinsa` command line manages the background service, from your own terminal.'
    );
  });

  test('install says what runs, where it logs, and whether a server already holds the data folder', async () => {
    const fake = createServiceClient(createService());
    expect((await runSpec(fake, ['service', 'install'])).text.split('\n')).toEqual([
      'Installed the background service (studio.overclock.shinsa). launchd starts Shinsa at login and again after a crash.',
      'Runs: /bin/bun /src/shinsa/apps/server/src/main.ts serve',
      `Plist: ${STATUS.plist}`,
      `Logs: ${STATUS.log}`,
    ]);
    const busy = createServiceClient(
      createService({
        install: () =>
          Promise.resolve({
            label: STATUS.label,
            plist: STATUS.plist,
            log: STATUS.log,
            program: ['bun'],
            replaced: true,
            running: STATUS.server,
          }),
      })
    );
    const text = (await runSpec(busy, ['service', 'install'])).text.split('\n');
    expect(text[0]).toStartWith('Reinstalled the background service');
    expect(text.at(-1)).toBe(
      'Shinsa is already running on this data directory at http://127.0.0.1:5180 (pid 4242). The service stays stopped while it runs: stop it, then run `shinsa service restart`.'
    );
  });

  test('uninstall says whether there was anything to remove', async () => {
    expect((await runSpec(createServiceClient(createService()), ['service', 'uninstall'])).text).toBe(
      'Removed the background service. Shinsa no longer starts at login.'
    );
    const none = createService({
      uninstall: () => Promise.resolve({ plist: STATUS.plist, wasLoaded: false, removedPlist: false }),
    });
    expect((await runSpec(createServiceClient(none), ['service', 'uninstall'])).text).toBe(
      'The background service was not installed.'
    );
  });

  test('status shows whether it is loaded and running, its pid, and the server’s port and version', async () => {
    expect(
      (await runSpec(createServiceClient(createService()), ['service', 'status'])).text.split('\n')
    ).toEqual([
      'Service: running (pid 4242)',
      'Server: http://127.0.0.1:5180 (port 5180, pid 4242, version 0.0.0 (fffffff)), run by the service',
      `Plist: ${STATUS.plist}`,
      `Logs: ${STATUS.log}`,
    ]);
    const shapes: [Partial<ServiceStatus>, string, string][] = [
      [
        { loaded: false, installed: false, pid: null, server: null },
        'Service: not installed',
        'Server: none on this data directory',
      ],
      [{ loaded: false, pid: null }, 'Service: installed, not loaded', 'Server: http'],
      [{ pid: null, lastExitCode: 1 }, 'Service: loaded, not running, last exit code 1', 'Server: http'],
      [{ pid: null }, 'Service: loaded, not running', 'Server: http'],
      [{ state: null }, 'Service: running (pid 4242)', 'Server: http'],
      [
        {
          server: {
            ...(STATUS.server as NonNullable<ServiceStatus['server']>),
            service: false,
            commit: null,
          },
        },
        'Service: running (pid 4242)',
        'Server: http://127.0.0.1:5180 (port 5180, pid 4242, version 0.0.0), started outside the service',
      ],
    ];
    for (const [overrides, job, server] of shapes) {
      const service = createService({ status: () => Promise.resolve({ ...STATUS, ...overrides }) });
      const [first, second] = (await runSpec(createServiceClient(service), ['service', 'status'])).text.split(
        '\n'
      );
      expect(first).toBe(job);
      expect(second).toStartWith(server);
    }
  });

  test('restart kickstarts it and shows the status after', async () => {
    const result = await runSpec(createServiceClient(createService()), ['service', 'restart']);
    expect(result.text.split('\n').slice(0, 2)).toEqual([
      'Restarted the background service.',
      'Service: running (pid 4242)',
    ]);
  });

  test('logs prints the last lines, 50 by default, or says there is no log yet', async () => {
    expect((await runSpec(createServiceClient(createService()), ['service', 'logs'])).text).toBe(
      'one\ntwo\n50'
    );
    expect(
      (await runSpec(createServiceClient(createService()), ['service', 'logs', '--lines', '5'])).text
    ).toBe('one\ntwo\n5');
    const empty = createService({ logs: () => ({ path: STATUS.log, lines: [] }) });
    expect((await runSpec(createServiceClient(empty), ['service', 'logs'])).text).toBe(
      `No log yet at ${STATUS.log}.`
    );
  });
});
