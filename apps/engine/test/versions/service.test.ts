import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import type { ProgramId } from '@shinsa/core';
import { Deferred, Effect, Fiber, Layer } from 'effect';
import { TestClock } from 'effect/testing';
import { ProgramVersions } from '../../src/agents/providers/versions/service.ts';
import { JsonLogger } from '../../src/log/service.ts';
import type { CommandResult } from '../../src/shell/schema.ts';
import { ProgramInstalls } from '../../src/versions/installs/service.ts';
import { NpmRegistry } from '../../src/versions/registry/service.ts';
import {
  LATEST_TTL_MS,
  type LineListener,
  NpmRegistryFailed,
  type Updater,
  VersionsCallFailed,
} from '../../src/versions/schema.ts';
import { Versions } from '../../src/versions/service.ts';
import { UpdaterRunner } from '../../src/versions/updater/service.ts';
import { runTest } from '../harness.ts';
import { captureLogs, until } from '../helpers/index.ts';
import { createFakeVersionsLayer, createVersionsLayer, type FakePrograms } from './fakes.ts';

const FAKE_CLAUDE = join(import.meta.dir, '../helpers/bin/claude');

const PASSED: CommandResult = { ok: true, code: 0, stdout: '', stderr: '', timedOut: false };

interface FakeMachine {
  installed: Record<ProgramId, string | null>;
  paths: Record<ProgramId, string | null>;
  overrides: Record<ProgramId, string | null>;
  latest: Record<string, string>;
  lookups: string[];
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
  };
}

function createPrograms(machine: FakeMachine, fake: FakePrograms = {}): FakePrograms {
  return {
    locate: (program) => ({
      path: machine.overrides[program] ?? machine.paths[program],
      override: machine.overrides[program],
    }),
    readVersion: (program) => machine.installed[program],
    latest: (name) => {
      machine.lookups.push(name);
      const version = machine.latest[name];
      if (version) return Effect.succeed(version);
      return Effect.fail(new NpmRegistryFailed({ packageName: name, message: `No ${name}.` }));
    },
    ...fake,
  };
}

interface RunOptions {
  inspect?: boolean;
  live?: boolean;
  onUpdated?: (program: ProgramId) => void;
}

function runVersions<A, E>(
  programs: Layer.Layer<ProgramInstalls | NpmRegistry | UpdaterRunner>,
  body: (versions: Versions['Service']) => Effect.Effect<A, E>,
  options: RunOptions = {}
) {
  const { onUpdated } = options;
  const layer = createVersionsLayer(programs, {
    inspect: options.inspect ?? false,
    onUpdated: (program) => Effect.sync(() => onUpdated?.(program)),
  });
  const program = Versions.use(body).pipe(Effect.provide(Layer.merge(layer, JsonLogger)));
  if (options.live) return runTest(program);
  return runTest(Effect.andThen(TestClock.setTime(1_000), program).pipe(Effect.provide(TestClock.layer())));
}

function runMachine<A, E>(
  machine: FakeMachine,
  body: (versions: Versions['Service']) => Effect.Effect<A, E>,
  fake: FakePrograms = {},
  options: RunOptions = {}
) {
  return runVersions(createFakeVersionsLayer(createPrograms(machine, fake)), body, options);
}

function installOnRun(machine: FakeMachine, program: ProgramId, version: string, lines: string[] = []) {
  return (_updater: Updater, onLine: LineListener) =>
    Effect.sync(() => {
      for (const line of lines) onLine(line);
      machine.installed[program] = version;
      return PASSED;
    });
}

const ignore = () => undefined;

describe('the versions snapshot', () => {
  test('shows each program’s installed, latest and minimum version, its updater, and the Agent SDK', async () => {
    const machine = createMachine();
    const snapshot = await runMachine(machine, (versions) => versions.snapshot);
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
    const statuses = await runMachine(machine, (versions) =>
      Effect.map(versions.snapshot, (snapshot) => snapshot.programs.map((program) => program.status))
    );
    expect(statuses).toEqual(['outdated', 'unknown']);
    machine.paths.claude = null;
    machine.overrides.codex = '/opt/wrappers/codex';
    const programs = await runMachine(machine, (versions) =>
      Effect.map(versions.snapshot, (snapshot) => snapshot.programs)
    );
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
    await runMachine(machine, (versions) =>
      Effect.gen(function* () {
        yield* Effect.all([versions.snapshot, versions.snapshot], { concurrency: 'unbounded' });
        expect(machine.lookups).toHaveLength(3);
        yield* TestClock.adjust(LATEST_TTL_MS - 1);
        yield* versions.snapshot;
        expect(machine.lookups).toHaveLength(3);
        yield* TestClock.adjust(1);
        yield* versions.snapshot;
        expect(machine.lookups).toHaveLength(6);
        expect((yield* versions.refresh).latestCheckedAt).toBe(1_000 + LATEST_TTL_MS);
        expect(machine.lookups).toHaveLength(9);
      })
    );
  });

  test('a lookup that fails is logged and keeps what was known', async () => {
    const machine = createMachine();
    const logs = captureLogs();
    try {
      const snapshot = await runMachine(machine, (versions) =>
        Effect.gen(function* () {
          yield* versions.snapshot;
          delete machine.latest['@openai/codex'];
          return yield* versions.refresh;
        })
      );
      expect(snapshot.programs[1]?.latest).toBe('0.164.0');
      expect(logs.fieldsOf('[Versions] Could not read the latest version')).toEqual([
        { name: '@openai/codex', error: 'No @openai/codex.' },
      ]);
    } finally {
      logs.restore();
    }
  });

  test('without fakes it reads the programs on the PATH and the SDK Shinsa depends on', async () => {
    const programs = Layer.mergeAll(
      ProgramInstalls.layer.pipe(Layer.provide(ProgramVersions.layer)),
      Layer.succeed(NpmRegistry, NpmRegistry.of({ latest: () => Effect.succeed('1.0.0') })),
      UpdaterRunner.layer
    );
    const snapshot = await runTest(
      Versions.use((versions) => versions.snapshot).pipe(
        Effect.provide(Layer.merge(createVersionsLayer(programs), JsonLogger))
      )
    );
    expect(snapshot.programs[0]).toMatchObject({ version: '99.0.0', minimum: expect.stringMatching(/^2\./) });
    expect(snapshot.programs[1]?.path).toEndWith('/helpers/bin/codex');
    expect(snapshot.sdk.version).toMatch(/^0\./);
  });
});

describe('updating a program', () => {
  test('runs its updater, streams the cleaned output, checks the sign-ins again and reads the new version', async () => {
    const machine = createMachine();
    const updated: ProgramId[] = [];
    const lines: string[] = [];
    const holder: { versions: Versions['Service'] | null; seen: boolean[] } = { versions: null, seen: [] };
    const outcome = await runMachine(
      machine,
      (versions) =>
        Effect.gen(function* () {
          holder.versions = versions;
          const update = yield* versions.startUpdate('claude');
          return yield* update((line) => lines.push(line));
        }),
      {
        run: (updater, onLine) =>
          Effect.gen(function* () {
            const versions = holder.versions;
            if (versions)
              holder.seen = (yield* versions.snapshot).programs.map((program) => program.updating);
            expect(updater.command).toEqual(['/opt/bin/claude', 'update']);
            return yield* installOnRun(machine, 'claude', '2.1.310', [
              '\u001b[32mChecking for updates\u001b[0m',
              '   ',
              'Done',
            ])(updater, onLine);
          }).pipe(Effect.orDie),
      },
      { onUpdated: (program) => updated.push(program) }
    );
    expect(holder.seen).toEqual([true, false]);
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
    const update = (program: ProgramId) => (versions: Versions['Service']) =>
      Effect.flatMap(versions.startUpdate(program), (run) => run(ignore));
    const current = await runMachine(machine, update('codex'), {
      run: installOnRun(machine, 'codex', '0.164.0'),
    });
    expect(current).toMatchObject({ ok: true, message: 'Codex is up to date.' });
    const behind = await runMachine(machine, update('claude'), {
      run: installOnRun(machine, 'claude', '2.1.287'),
    });
    expect(behind).toMatchObject({
      ok: false,
      message: 'The update finished, but Claude Code still reports 2.1.287 (latest is 2.1.310).',
    });
  });

  test('a failed updater reports its last line, or that it was stopped, and checks nothing again', async () => {
    const machine = createMachine();
    const updated: ProgramId[] = [];
    const logs = captureLogs();
    const failWith = (result: Partial<CommandResult>) =>
      runMachine(
        machine,
        (versions) => Effect.flatMap(versions.startUpdate('claude'), (run) => run(ignore)),
        { run: () => Effect.succeed({ ...PASSED, ok: false, code: 1, ...result }) },
        { onUpdated: (program) => updated.push(program) }
      );
    try {
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
    } finally {
      logs.restore();
    }
  });

  test('refuses an unknown program, inspect mode, a second update, a missing program and an override', async () => {
    const machine = createMachine();
    const refuse = (program: string) => (versions: Versions['Service']) =>
      Effect.flip(versions.startUpdate(program));
    expect(await runMachine(machine, refuse('gh'))).toMatchObject({ message: 'Update claude or codex.' });
    expect(await runMachine(machine, refuse('claude'), {}, { inspect: true })).toMatchObject({
      message: 'Inspect mode is read-only.',
    });
    const refusals = await runMachine(
      machine,
      (versions) =>
        Effect.gen(function* () {
          const finished = yield* Deferred.make<CommandResult>();
          holderRun.finished = finished;
          const run = yield* versions.startUpdate('claude');
          const running = yield* Effect.forkChild(run(ignore));
          const second = yield* Effect.flip(versions.startUpdate('claude'));
          yield* Deferred.succeed(finished, PASSED);
          yield* Fiber.join(running);
          machine.paths.codex = null;
          const missing = yield* Effect.flip(versions.startUpdate('codex'));
          machine.overrides.claude = '/opt/wrappers/claude';
          const overridden = yield* Effect.flip(versions.startUpdate('claude'));
          return [second, missing, overridden].map((error) => error.message);
        }),
      {
        run: () =>
          Effect.suspend(() =>
            holderRun.finished ? Deferred.await(holderRun.finished) : Effect.succeed(PASSED)
          ),
      }
    );
    expect(refusals).toEqual([
      'Claude Code is already updating.',
      'Codex is not installed.',
      'Update Claude Code yourself (CLAUDE_EXECUTABLE).',
    ]);
  });

  test('a failure inside the update still frees the program', async () => {
    const machine = createMachine();
    const { failure, updating } = await runMachine(
      machine,
      (versions) =>
        Effect.gen(function* () {
          const run = yield* versions.startUpdate('claude');
          const failed = yield* Effect.flip(run(ignore));
          return { failure: failed, updating: (yield* versions.snapshot).programs[0]?.updating };
        }),
      { run: () => Effect.fail(new VersionsCallFailed({ message: 'spawn failed' })) }
    );
    expect(failure).toMatchObject({ _tag: 'VersionsCallFailed', message: 'spawn failed' });
    expect(updating).toBe(false);
  });

  test('the default runner runs the updater it is given, and stop cancels a running one', async () => {
    const machine = createMachine();
    const lines: string[] = [];
    const logs = captureLogs();
    try {
      const outcome = await runMachine(
        machine,
        (versions) =>
          Effect.gen(function* () {
            const run = yield* versions.startUpdate('claude');
            const running = yield* Effect.forkChild(run((line) => lines.push(line)));
            yield* Effect.promise(() => until('the updater printed', () => lines.length > 0));
            yield* versions.stop;
            return yield* Fiber.join(running);
          }),
        {
          run: undefined,
          updater: () => ({
            command: ['sh', '-c', 'echo "$NO_COLOR $EXTRA"; sleep 30'],
            label: 'test',
            env: { EXTRA: 'set' },
          }),
        },
        { live: true }
      );
      expect(lines).toEqual(['1 set']);
      expect(outcome.ok).toBe(false);
    } finally {
      logs.restore();
    }
  });

  test('an updater whose program is missing reports that it did not start', async () => {
    const machine = createMachine();
    const logs = captureLogs();
    try {
      const { outcome, updating } = await runMachine(
        machine,
        (versions) =>
          Effect.gen(function* () {
            const finished = yield* Effect.flatMap(versions.startUpdate('claude'), (run) => run(ignore));
            return { outcome: finished, updating: finished.versions.programs[0]?.updating };
          }),
        { updater: () => ({ command: ['/no/such/updater'], label: 'missing' }) },
        { live: true }
      );
      expect(outcome.ok).toBe(false);
      expect(outcome.message).toStartWith('Couldn’t update Claude Code: ');
      expect(updating).toBe(false);
    } finally {
      logs.restore();
    }
  });

  test('the fake claude on the PATH answers the real `claude update` invocation', async () => {
    const outcome = await runVersions(
      createFakeVersionsLayer({
        locate: () => ({ path: FAKE_CLAUDE, override: null }),
        readVersion: () => '99.0.0',
        latest: () => Effect.succeed('99.0.0'),
      }),
      (versions) => Effect.flatMap(versions.startUpdate('claude'), (run) => run(ignore)),
      { live: true }
    );
    expect(outcome).toMatchObject({ ok: true, message: 'Claude Code is up to date.' });
  });
});

const holderRun: { finished: Deferred.Deferred<CommandResult> | null } = { finished: null };
