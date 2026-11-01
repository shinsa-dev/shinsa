import { describe, expect, spyOn, test } from 'bun:test';
import { join } from 'node:path';
import type { ProgramId } from '@shinsa/core';
import { log } from '../../src/log/index.ts';
import type { CommandResult } from '../../src/shell/index.ts';
import {
  LATEST_TTL_MS,
  type UpdateRunner,
  Versions,
  type VersionsOptions,
} from '../../src/versions/index.ts';
import { until } from '../helpers/index.ts';

const FAKE_CLAUDE = join(import.meta.dir, '../helpers/bin/claude');

const PASSED: CommandResult = { ok: true, code: 0, stdout: '', stderr: '', timedOut: false };

interface FakeMachine {
  installed: Record<ProgramId, string | null>;
  paths: Record<ProgramId, string | null>;
  overrides: Record<ProgramId, string | null>;
  latest: Record<string, string>;
  lookups: string[];
  now: number;
}

function createMachine(): FakeMachine {
  return {
    installed: { claude: '2.1.287', codex: '0.164.0' },
    paths: { claude: '/opt/bin/claude', codex: '/opt/bin/codex' },
    overrides: { claude: null, codex: null },
    latest: {
      '@anthropic-ai/claude-code': '2.1.310',
      '@openai/codex': '0.164.0',
      '@anthropic-ai/claude-agent-sdk': '0.3.310',
    },
    lookups: [],
    now: 1_000,
  };
}

function createVersions(machine: FakeMachine, options: VersionsOptions = {}) {
  return new Versions({
    locate: (program) => ({
      path: machine.overrides[program] ?? machine.paths[program],
      override: machine.overrides[program],
    }),
    readVersion: (program) => Promise.resolve(machine.installed[program]),
    minimum: (program) => (program === 'claude' ? '2.1.280' : '0.153.0'),
    sdk: () => ({ version: '0.3.280', claudeCodeVersion: '2.1.280' }),
    latest: (name) => {
      machine.lookups.push(name);
      const version = machine.latest[name];
      return version ? Promise.resolve(version) : Promise.reject(new Error(`No ${name}.`));
    },
    now: () => machine.now,
    ...options,
  });
}

function installOnRun(
  machine: FakeMachine,
  program: ProgramId,
  version: string,
  lines: string[] = []
): UpdateRunner {
  return (_updater, onLine) => {
    for (const line of lines) onLine(line);
    machine.installed[program] = version;
    return Promise.resolve(PASSED);
  };
}

describe('the versions snapshot', () => {
  test('shows each program’s installed, latest and minimum version, its updater, and the Agent SDK', async () => {
    const machine = createMachine();
    const snapshot = await createVersions(machine).snapshot();
    expect(snapshot).toEqual({
      programs: [
        {
          id: 'claude',
          label: 'Claude Code',
          path: '/opt/bin/claude',
          version: '2.1.287',
          latest: '2.1.310',
          minimum: '2.1.280',
          status: 'update_available',
          updater: 'claude update',
          override: null,
          updating: false,
        },
        {
          id: 'codex',
          label: 'Codex',
          path: '/opt/bin/codex',
          version: '0.164.0',
          latest: '0.164.0',
          minimum: '0.153.0',
          status: 'current',
          updater: 'codex update',
          override: null,
          updating: false,
        },
      ],
      sdk: {
        name: '@anthropic-ai/claude-agent-sdk',
        version: '0.3.280',
        claudeCodeVersion: '2.1.280',
        latest: '0.3.310',
      },
      latestCheckedAt: 1_000,
    });
  });

  test('a program below the minimum is outdated; a missing, unreadable or overridden one says so', async () => {
    const machine = createMachine();
    machine.installed = { claude: '2.1.100', codex: null };
    let programs = (await createVersions(machine).snapshot()).programs;
    expect(programs.map((program) => program.status)).toEqual(['outdated', 'unknown']);
    machine.paths.claude = null;
    machine.overrides.codex = '/opt/wrappers/codex';
    programs = (await createVersions(machine).snapshot()).programs;
    expect(programs[0]).toMatchObject({ status: 'not_installed', path: null, version: null, updater: null });
    expect(programs[1]).toMatchObject({
      status: 'unknown',
      path: '/opt/wrappers/codex',
      override: '/opt/wrappers/codex',
      updater: null,
    });
  });

  test('the latest versions are looked up once for a few hours, together, and a refresh looks again', async () => {
    const machine = createMachine();
    const versions = createVersions(machine);
    await Promise.all([versions.snapshot(), versions.snapshot()]);
    expect(machine.lookups).toHaveLength(3);
    machine.now += LATEST_TTL_MS - 1;
    await versions.snapshot();
    expect(machine.lookups).toHaveLength(3);
    machine.now += 1;
    await versions.snapshot();
    expect(machine.lookups).toHaveLength(6);
    expect((await versions.refresh()).latestCheckedAt).toBe(machine.now);
    expect(machine.lookups).toHaveLength(9);
  });

  test('a lookup that fails is logged and keeps what was known', async () => {
    const machine = createMachine();
    const versions = createVersions(machine);
    await versions.snapshot();
    const warn = spyOn(log, 'warn').mockImplementation(() => undefined);
    delete machine.latest['@openai/codex'];
    const snapshot = await versions.refresh();
    expect(snapshot.programs[1]?.latest).toBe('0.164.0');
    expect(warn).toHaveBeenCalledWith('[Versions] Could not read the latest version', {
      name: '@openai/codex',
      error: 'No @openai/codex.',
    });
    warn.mockRestore();
  });

  test('without fakes it reads the programs on the PATH and the SDK Shinsa depends on', async () => {
    const snapshot = await new Versions({ latest: () => Promise.resolve('1.0.0') }).snapshot();
    expect(snapshot.programs[0]).toMatchObject({ version: '99.0.0', minimum: expect.stringMatching(/^2\./) });
    expect(snapshot.programs[1]?.path).toEndWith('/helpers/bin/codex');
    expect(snapshot.sdk.version).toMatch(/^0\./);
  });
});

describe('updating a program', () => {
  test('runs its updater, streams the cleaned output, checks the sign-ins again and reads the new version', async () => {
    const machine = createMachine();
    const updated: ProgramId[] = [];
    let seen: boolean[] = [];
    const lines: string[] = [];
    const versions = createVersions(machine, {
      onUpdated: (program) => {
        updated.push(program);
        return Promise.resolve();
      },
      run: async (updater, onLine) => {
        seen = (await versions.snapshot()).programs.map((program) => program.updating);
        expect(updater.command).toEqual(['/opt/bin/claude', 'update']);
        return installOnRun(machine, 'claude', '2.1.310', [
          '\u001b[32mChecking for updates\u001b[0m',
          '   ',
          'Done',
        ])(updater, onLine, new AbortController().signal);
      },
    });
    const outcome = await versions.startUpdate('claude')((line) => lines.push(line));
    expect(seen).toEqual([true, false]);
    expect(lines).toEqual(['Checking for updates', 'Done']);
    expect(updated).toEqual(['claude']);
    expect(outcome.ok).toBe(true);
    expect(outcome.message).toBe('Updated Claude Code to 2.1.310.');
    expect(outcome.versions.programs[0]).toMatchObject({
      version: '2.1.310',
      status: 'current',
      updating: false,
    });
  });

  test('an update that changes nothing says the program is up to date, or that it is still behind', async () => {
    const machine = createMachine();
    const ignore = () => undefined;
    const current = await createVersions(machine, {
      run: installOnRun(machine, 'codex', '0.164.0'),
    }).startUpdate('codex')(ignore);
    expect(current).toMatchObject({ ok: true, message: 'Codex is up to date.' });
    const behind = await createVersions(machine, {
      run: installOnRun(machine, 'claude', '2.1.287'),
    }).startUpdate('claude')(ignore);
    expect(behind).toMatchObject({
      ok: false,
      message: 'The update finished, but Claude Code still reports 2.1.287 (latest is 2.1.310).',
    });
  });

  test('a failed updater reports its last line, or that it was stopped, and checks nothing again', async () => {
    const machine = createMachine();
    const updated: ProgramId[] = [];
    const warn = spyOn(log, 'warn').mockImplementation(() => undefined);
    const failWith = (result: Partial<CommandResult>) =>
      createVersions(machine, {
        onUpdated: (program) => {
          updated.push(program);
          return Promise.resolve();
        },
        run: () => Promise.resolve({ ...PASSED, ok: false, code: 1, ...result }),
      }).startUpdate('claude')(() => undefined);
    expect(
      (
        await failWith({
          stderr: 'Downloading\nPermission denied (ghp_abcdefghijklmnopqrstuvwxyz0123456789)',
        })
      ).message
    ).toBe('Couldn’t update Claude Code: Permission denied (***)');
    expect((await failWith({ timedOut: true, stdout: 'Downloading' })).message).toBe(
      'Couldn’t update Claude Code: it ran too long and was stopped'
    );
    const silent = await failWith({ code: 7 });
    expect(silent).toMatchObject({ ok: false, message: 'Couldn’t update Claude Code: exit 7' });
    expect(silent.versions.programs[0]?.updating).toBe(false);
    expect(updated).toEqual([]);
    warn.mockRestore();
  });

  test('refuses an unknown program, inspect mode, a second update, a missing program and an override', async () => {
    const machine = createMachine();
    expect(() => createVersions(machine).startUpdate('gh')).toThrow('Update claude or codex.');
    expect(() => createVersions(machine, { inspect: true }).startUpdate('claude')).toThrow(
      'Inspect mode is read-only.'
    );
    const finished = Promise.withResolvers<CommandResult>();
    const versions = createVersions(machine, { run: () => finished.promise });
    const running = versions.startUpdate('claude')(() => undefined);
    expect(() => versions.startUpdate('claude')).toThrow('Claude Code is already updating.');
    finished.resolve(PASSED);
    await running;
    machine.paths.codex = null;
    expect(() => versions.startUpdate('codex')).toThrow('Codex is not installed.');
    machine.overrides.claude = '/opt/wrappers/claude';
    expect(() => versions.startUpdate('claude')).toThrow('Update Claude Code yourself (CLAUDE_EXECUTABLE).');
  });

  test('a failure inside the update still frees the program', async () => {
    const machine = createMachine();
    const versions = createVersions(machine, { run: () => Promise.reject(new Error('spawn failed')) });
    await expect(versions.startUpdate('claude')(() => undefined)).rejects.toThrow('spawn failed');
    expect((await versions.snapshot()).programs[0]?.updating).toBe(false);
  });

  test('the default runner runs the updater it is given, and stop cancels a running one', async () => {
    const machine = createMachine();
    const lines: string[] = [];
    const versions = createVersions(machine, {
      updater: () => ({
        command: ['sh', '-c', 'echo "$NO_COLOR $EXTRA"; sleep 30'],
        label: 'test',
        env: { EXTRA: 'set' },
      }),
    });
    const warn = spyOn(log, 'warn').mockImplementation(() => undefined);
    const running = versions.startUpdate('claude')((line) => lines.push(line));
    await until('the updater printed', () => lines.length > 0);
    versions.stop();
    const outcome = await running;
    expect(lines).toEqual(['1 set']);
    expect(outcome.ok).toBe(false);
    warn.mockRestore();
  });

  test('the fake claude on the PATH answers the real `claude update` invocation', async () => {
    const versions = new Versions({
      latest: () => Promise.resolve('99.0.0'),
      locate: () => ({ path: FAKE_CLAUDE, override: null }),
    });
    expect(await versions.startUpdate('claude')(() => undefined)).toMatchObject({
      ok: true,
      message: 'Claude Code is up to date.',
    });
  });
});
