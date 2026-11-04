import { afterEach, describe, expect, setDefaultTimeout, spyOn, test } from 'bun:test';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  type BundlePullRequest,
  CI_GRACE_MS,
  createPullRequestWatch,
  evaluatePullRequestWatch,
  type PullRequest,
  type ShinsaCommand,
  type ShinsaState,
  type Task,
} from '@shinsa/core';
import { Effect } from 'effect';
import type { RunSupervisor } from '../../src/agents/supervisor/service.ts';
import { BriefingWriter } from '../../src/briefing/service.ts';
import { resolveScratchPath, type ServerConfig } from '../../src/config/index.ts';
import { NO_DRAFT, STOPPED_WHILE_FILING } from '../../src/feedback/effects/schema.ts';
import { GitFailed } from '../../src/git/schema.ts';
import { resolveEffectFailure } from '../../src/runtime/failures/classify.ts';
import { EffectFailed, ShippingFailed } from '../../src/runtime/failures/schema.ts';
import { type EffectRunnerOptions } from '../../src/runtime/index.ts';
import type { Slack } from '../../src/slack/index.ts';
import type { Workspaces } from '../../src/workspaces/service.ts';
import { EffectRunner } from '../helpers/effects.ts';
import { Engine } from '../helpers/engine.ts';
import { openEventLog } from '../helpers/event-log.ts';
import { createWorktree, inspectRepo } from '../helpers/git.ts';
import {
  captureLogs,
  createGitRepo,
  createTempDir,
  createTestConfig,
  git,
  NO_HANDOFFS,
  NO_PREVIEWS,
  NO_SHARES,
  overrideEnv,
  type TestRepo,
  until,
  writeFiles,
} from '../helpers/index.ts';
import { createRepo, createRound, createStubEngine, createTask } from '../helpers/state.ts';
import { createMonitor } from '../resources/harness.ts';
import { resolveTriageEffect } from '../triage/harness.ts';

setDefaultTimeout(30_000);

const GH_WAIT_MS = 25_000;

const restores: (() => void)[] = [];

afterEach(() => {
  for (const restore of restores.splice(0)) restore();
});

interface FakeGitHub {
  pulls: Record<string, unknown>[];
  calls: string[][];
  failReads?: number;
  mergeQueue?: boolean;
  workflows?: Record<string, string>;
}

function useFakeGitHub(pulls: unknown[] = [], extra: Partial<FakeGitHub> = {}) {
  const path = join(createTempDir(), 'gh.json');
  const write = (state: object) => writeFileSync(path, JSON.stringify(state));
  write({ next: pulls.length + 1, defaultChecks: 'passing', pulls, calls: [], ...extra });
  restores.push(overrideEnv({ FAKE_GH_STATE: path }));
  const read = () => JSON.parse(readFileSync(path, 'utf8')) as FakeGitHub;
  return Object.assign(read, {
    change: (patch: (state: FakeGitHub) => void) => {
      const state = read();
      patch(state);
      write(state);
    },
  });
}

function useFailingGh(failing: string, code = 1, message = 'gh is down') {
  const dir = createTempDir();
  const real = join(import.meta.dirname, '../helpers/bin/gh');
  writeFileSync(
    join(dir, 'gh'),
    `#!/bin/sh\ncase "$*" in *"${failing}"*) echo "${message}" >&2; exit ${code};; esac\nexec "${real}" "$@"\n`,
    { mode: 0o755 }
  );
  restores.push(overrideEnv({ PATH: `${dir}:${process.env.PATH ?? ''}` }));
}

function useHangingGh(failing: string) {
  const dir = createTempDir();
  const pidFile = join(dir, 'gh.pid');
  const real = join(import.meta.dirname, '../helpers/bin/gh');
  writeFileSync(
    join(dir, 'gh'),
    `#!/bin/sh\ncase "$*" in *"${failing}"*) echo $$ > "${pidFile}"; exec sleep 30;; esac\nexec "${real}" "$@"\n`,
    { mode: 0o755 }
  );
  restores.push(overrideEnv({ PATH: `${dir}:${process.env.PATH ?? ''}` }));
  return () => Number(existsSync(pidFile) ? readFileSync(pidFile, 'utf8').trim() : 0);
}

function useGhBefore(matching: string, command: string) {
  const dir = createTempDir();
  const real = join(import.meta.dirname, '../helpers/bin/gh');
  writeFileSync(
    join(dir, 'gh'),
    `#!/bin/sh\ncase "$*" in *"${matching}"*) ${command};; esac\nexec "${real}" "$@"\n`,
    { mode: 0o755 }
  );
  restores.push(overrideEnv({ PATH: `${dir}:${process.env.PATH ?? ''}` }));
}

function useHeldGh(held: string) {
  const dir = createTempDir();
  const real = join(import.meta.dirname, '../helpers/bin/gh');
  const release = join(dir, 'release');
  writeFileSync(
    join(dir, 'gh'),
    [
      '#!/bin/sh',
      `case "$*" in *"${held}"*) if mkdir "${dir}/taken" 2>/dev/null; then`,
      `  out=$("${real}" "$@"); code=$?`,
      `  while [ ! -f "${release}" ]; do sleep 0.01; done`,
      `  printf '%s\\n' "$out"; exit $code`,
      'fi;; esac',
      `exec "${real}" "$@"`,
      '',
    ].join('\n'),
    { mode: 0o755 }
  );
  restores.push(overrideEnv({ PATH: `${dir}:${process.env.PATH ?? ''}` }));
  return () => writeFileSync(release, '');
}

function isRunning(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function useHangingFetch(path: string) {
  const dir = createTempDir();
  const pidFile = join(dir, 'fetch.pid');
  const uploadPack = join(dir, 'upload-pack');
  writeFileSync(uploadPack, `#!/bin/sh\necho $$ > "${pidFile}"\nexec sleep 30\n`, { mode: 0o755 });
  await git(path, 'config', 'remote.origin.uploadpack', uploadPack);
  return () => Number(existsSync(pidFile) ? readFileSync(pidFile, 'utf8').trim() : 0);
}

let effectCount = 0;

function createContext(signal: AbortSignal = new AbortController().signal) {
  effectCount += 1;
  return { key: `effect-${effectCount}`, attempt: 1, signal };
}

function createRuns() {
  const calls: string[] = [];
  const runs = {
    execute: (runId: string) =>
      Effect.sync(() => {
        calls.push(`execute:${runId}`);
      }),
    cancel: (runId: string) =>
      Effect.sync(() => {
        calls.push(`cancel:${runId}`);
      }),
    steer: (runId: string, text: string, cause: string) =>
      Effect.sync(() => {
        calls.push(`steer:${runId}:${text}:${cause}`);
      }),
    resolveQuestion: (gateId: string) =>
      Effect.sync(() => {
        calls.push(`question:${gateId}`);
      }),
    quiesce: (taskId: string) =>
      Effect.sync(() => {
        calls.push(`quiesce:${taskId}`);
      }),
    wake: (runId: string, generation: number) =>
      Effect.sync(() => {
        calls.push(`wake:${runId}:${generation}`);
      }),
    deliver: (runId: string, generation: number) =>
      Effect.sync(() => {
        calls.push(`deliver:${runId}:${generation}`);
      }),
    replyToDelegate: (runId: string, questionId: string) =>
      Effect.sync(() => {
        calls.push(`reply:${runId}:${questionId}`);
      }),
  };
  return { runs: runs as unknown as RunSupervisor['Service'], calls };
}

function createBriefings() {
  let scheduled = 0;
  return {
    briefings: BriefingWriter.of({
      schedule: Effect.sync(() => {
        scheduled += 1;
      }),
      stop: Effect.void,
    }),
    scheduled: () => scheduled,
  };
}

function setup(
  patch: (state: ShinsaState) => void = () => undefined,
  options: Partial<EffectRunnerOptions> & { config?: Partial<ServerConfig> } = {}
) {
  const stub = createStubEngine(patch);
  const config = createTestConfig(createTempDir(), options.config);
  const { runs, calls } = createRuns();
  const briefings = createBriefings();
  const runner = new EffectRunner(stub.engine, config, runs, briefings.briefings, {
    shares: NO_SHARES,
    previews: NO_PREVIEWS,
    handoffs: NO_HANDOFFS,
    resolveLogin: () => Promise.resolve(null),
    triage: (state, task, local) => resolveTriageEffect(state, task, local, () => Effect.succeed(null)),
    ...options,
  });
  return { ...stub, config, runner, calls, scheduled: briefings.scheduled };
}

function withTask(task: Partial<Task>, repo: Partial<ReturnType<typeof createRepo>> = {}) {
  return (state: ShinsaState) => {
    state.repos['repo-1'] = createRepo(repo);
    state.tasks['task-1'] = createTask(task);
  };
}

const PULL: PullRequest = {
  number: 7,
  url: 'https://github.com/acme/app/pull/7',
  base: 'main',
  state: 'open',
  checks: 'passing',
  unresolvedComments: 0,
  mergeable: true,
  headSha: null,
  updatedAt: 1,
};

function fakePull(head: string, overrides: Record<string, unknown> = {}) {
  return {
    number: 7,
    head,
    base: 'main',
    state: 'OPEN',
    checks: 'passing',
    mergeable: 'MERGEABLE',
    unresolved: 0,
    mergedWith: null,
    ...overrides,
  };
}

function records(dispatched: ShinsaCommand[]) {
  return dispatched.flatMap((command) => (command.type === 'pull_request.record' ? [command] : []));
}

async function createShippingRepo(): Promise<TestRepo & { worktree: string }> {
  const repo = await createGitRepo();
  const worktree = await createWorktree(repo.repo, createTempDir(), 'task-1', 'fix/tab-scroll', null);
  writeFiles(worktree.path, { 'a.txt': 'a' });
  await git(worktree.path, 'add', '-A');
  await git(worktree.path, 'commit', '-q', '-m', 'fix: a');
  return { ...repo, worktree: worktree.path };
}

describe('routing effects', () => {
  test('disposing releases the runner’s services, so a sync asked for after shutdown is refused', async () => {
    const { runner } = setup();
    await runner.stop();
    await runner.dispose();
    await expect(runner.syncAll()).rejects.toThrow();
  });

  test('run effects go to the supervisor, a steer with its effect key as the cause, and a briefing request to the briefings', async () => {
    const { runner, calls, scheduled } = setup();
    await runner.apply({ kind: 'run.execute', runId: 'r1' }, createContext());
    await runner.apply({ kind: 'run.cancel', runId: 'r1' }, createContext());
    const steer = createContext();
    await runner.apply({ kind: 'run.steer', runId: 'r1', text: 'hi' }, steer);
    await runner.apply({ kind: 'question.resolve', gateId: 'g1' }, createContext());
    await runner.apply({ kind: 'briefing.request', projectId: null }, createContext());
    expect(calls).toEqual(['execute:r1', 'cancel:r1', `steer:r1:hi:${steer.key}`, 'question:g1']);
    expect(scheduled()).toBe(1);
  });

  test('waking a run, steering a delegation and replying to one go to the supervisor', async () => {
    const { runner, calls } = setup();
    await runner.apply({ kind: 'run.wake', runId: 'r1', generation: 2 }, createContext());
    await runner.apply({ kind: 'delegation.steer', runId: 'r2', generation: 3 }, createContext());
    await runner.apply({ kind: 'delegation.reply', runId: 'r2', questionId: 'q1' }, createContext());
    expect(calls).toEqual(['wake:r1:2', 'deliver:r2:3', 'reply:r2:q1']);
  });

  test('an effect that failed for good opens one failure gate on its task, under an id the effect decides', async () => {
    const { runner, dispatched, commandIds } = setup();
    await runner.reportExhausted({ kind: 'pull_request.push', taskId: 't1' }, 'push rejected', 'push-key');
    await runner.reportExhausted({ kind: 'run.execute', runId: 'r1' }, 'x', 'run-key');
    await runner.reportExhausted({ kind: 'pull_request.watch', taskId: 't1' }, 'x', 'watch-key');
    expect(dispatched).toEqual([
      { type: 'effect.fail', taskId: 't1', title: 'Could not push the fixes', detail: 'push rejected' },
    ]);
    expect(commandIds).toEqual(['push-key:effect.fail']);
  });

  test('a hand-off link is made and taken back by the hand-offs, and one that could not be made is kept on its task', async () => {
    const handed: string[] = [];
    const { runner, dispatched, commandIds } = setup(undefined, {
      handoffs: {
        link: (taskId, effectContext) =>
          Effect.sync(() => {
            handed.push(`link:${taskId}:${effectContext.key}`);
          }),
        revoke: (taskId, guestId) =>
          Effect.sync(() => {
            handed.push(`revoke:${taskId}:${guestId}`);
          }),
      },
    });
    const context = createContext();
    await runner.apply({ kind: 'handoff.link', taskId: 't1' }, context);
    await runner.apply({ kind: 'handoff.revoke', taskId: 't1', guestId: '7' }, context);
    expect(handed).toEqual([`link:t1:${context.key}`, 'revoke:t1:7']);
    await runner.reportExhausted(
      { kind: 'handoff.link', taskId: 't1' },
      'Turn on remote access.',
      'handoff-key'
    );
    expect(dispatched).toEqual([{ type: 'handoff.fail', taskId: 't1', detail: 'Turn on remote access.' }]);
    expect(commandIds).toEqual(['handoff-key:handoff.fail']);
  });

  test('a share link is made by the shares, and one that could not be made is kept on its task', async () => {
    const shared: string[] = [];
    const { runner, dispatched, commandIds } = setup(undefined, {
      shares: {
        link: (taskId, effectContext) =>
          Effect.sync(() => {
            shared.push(`link:${taskId}:${effectContext.key}`);
          }),
      },
    });
    const context = createContext();
    await runner.apply({ kind: 'share.link', taskId: 't1' }, context);
    expect(shared).toEqual([`link:t1:${context.key}`]);
    await runner.reportExhausted({ kind: 'share.link', taskId: 't1' }, 'Turn on remote access.', 'share-key');
    expect(dispatched).toEqual([{ type: 'share.fail', taskId: 't1', detail: 'Turn on remote access.' }]);
    expect(commandIds).toEqual(['share-key:share.fail']);
  });

  test('a preview link is made by the previews, and one that could not be made is kept on its preview', async () => {
    const linked: string[] = [];
    const { runner, dispatched, commandIds } = setup(undefined, {
      previews: {
        link: (taskId, serviceId, effectContext) =>
          Effect.sync(() => {
            linked.push(`link:${taskId}:${serviceId}:${effectContext.key}`);
          }),
      },
    });
    const context = createContext();
    await runner.apply({ kind: 'preview.link', taskId: 't1', serviceId: 'web' }, context);
    expect(linked).toEqual([`link:t1:web:${context.key}`]);
    const effect = { kind: 'preview.link', taskId: 't1', serviceId: 'web' } as const;
    await runner.reportExhausted(effect, 'Turn on remote access.', 'preview-key');
    expect(dispatched).toEqual([
      { type: 'preview.fail', taskId: 't1', serviceId: 'web', detail: 'Turn on remote access.' },
    ]);
    expect(commandIds).toEqual(['preview-key:preview.fail']);
  });
});

describe('the Slack effects', () => {
  const THREAD = { teamId: 'T1', channelId: 'C1', threadTs: '1.1' };

  test('go to the Slack service', async () => {
    const handled: string[] = [];
    const record = (name: string) => Effect.sync(() => void handled.push(name));
    const slack = {
      evaluate: () => record('evaluate'),
      status: () => record('status'),
      post: () => record('post'),
      merge: () => record('merge'),
      react: () => record('react'),
    } as unknown as Slack['Service'];
    const { runner } = setup(() => undefined, { slack });
    const mention = {
      ...THREAD,
      eventId: 'Ev1',
      messageTs: '1.1',
      userId: 'U1',
      userName: 'A',
      text: '',
      permalink: null,
      channelName: null,
      thread: [],
    };
    await runner.apply({ kind: 'slack.evaluate', mention }, createContext());
    await runner.apply({ kind: 'slack.status', taskId: 't1', thread: THREAD }, createContext());
    await runner.apply(
      { kind: 'slack.post', thread: THREAD, taskId: 't1', post: { kind: 'result' } },
      createContext()
    );
    await runner.apply({ kind: 'slack.merge', thread: THREAD, taskId: 't1', round: 1 }, createContext());
    await runner.apply(
      { kind: 'slack.react', thread: THREAD, messageTs: '1.2', reaction: 'eyes' },
      createContext()
    );
    expect(handled).toEqual(['evaluate', 'status', 'post', 'merge', 'react']);
  });

  test('fail without one, so they wait in the outbox', async () => {
    const { runner } = setup();
    await expect(
      runner.apply({ kind: 'slack.status', taskId: 't1', thread: THREAD }, createContext())
    ).rejects.toThrow('Slack is not connected on this machine.');
  });
});

describe('suggesting a watch', () => {
  test('words the watch for the new integration and records it under an id the effect decides', async () => {
    const asked: string[] = [];
    const { runner, dispatched, commandIds } = setup(() => undefined, {
      timeZone: 'Europe/Sofia',
      wordWatch: (server, data) =>
        Effect.sync(() => {
          asked.push(`${server}: ${data}`);
          return {
            name: 'Bugs in #feedback',
            text: 'File a task for each new bug in #feedback.',
          };
        }),
    });
    const context = createContext();
    await runner.apply(
      { kind: 'watch.suggest', projectId: 'p1', server: 'slack', data: 'Bug reports in #feedback' },
      context
    );
    expect(asked).toEqual(['slack: Bug reports in #feedback']);
    expect(dispatched).toEqual([
      {
        type: 'watch_suggestion.record',
        projectId: 'p1',
        server: 'slack',
        name: 'Bugs in #feedback',
        text: 'File a task for each new bug in #feedback.',
        timeZone: 'Europe/Sofia',
      },
    ]);
    expect(commandIds).toEqual([`${context.key}:watch_suggestion.record`]);
  });

  test('without a writer it records the suggestion for core to word plainly, in the machine’s time zone', async () => {
    const { runner, dispatched } = setup();
    await runner.apply(
      { kind: 'watch.suggest', projectId: 'p1', server: 'maple', data: 'Errors' },
      createContext()
    );
    expect(dispatched).toEqual([
      {
        type: 'watch_suggestion.record',
        projectId: 'p1',
        server: 'maple',
        name: null,
        text: null,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
    ]);
  });
});

describe('describing a shared task', () => {
  test('writes the description of a shared task and records it under an id the effect decides', async () => {
    const asked: string[] = [];
    const { runner, dispatched, commandIds } = setup(
      withTask({ share: { at: 1, url: null, limit: 'until_done', preset: 'status', endsAt: null } }),
      {
        describeShare: (task) =>
          Effect.sync(() => {
            asked.push(task.id);
            return 'Tab groups now scroll sideways.';
          }),
      }
    );
    const context = createContext();
    await runner.apply({ kind: 'share.describe', taskId: 'task-1' }, context);
    expect(asked).toEqual(['task-1']);
    expect(dispatched).toEqual([
      { type: 'share.describe', taskId: 'task-1', description: 'Tab groups now scroll sideways.' },
    ]);
    expect(commandIds).toEqual([`${context.key}:share.describe`]);
  });

  test('records nothing for a task no longer shared, or when nothing was written', async () => {
    const unshared = setup(withTask({ share: null }), {
      describeShare: () => Effect.succeed('Unused.'),
    });
    await unshared.runner.apply({ kind: 'share.describe', taskId: 'task-1' }, createContext());
    expect(unshared.dispatched).toEqual([]);
    const silent = setup(
      withTask({ share: { at: 1, url: null, limit: 'until_done', preset: 'standard', endsAt: null } })
    );
    await silent.runner.apply({ kind: 'share.describe', taskId: 'task-1' }, createContext());
    expect(silent.dispatched).toEqual([]);
  });
});

describe('the feedback effects', () => {
  const ENTRY = {
    source: 'human' as const,
    note: 'The plan tab hides changes.',
    title: 'Plan tab hides changes',
    body: 'It hides them.',
    failure: null,
    issue: null,
    taskId: null,
    runId: null,
    createdAt: 1,
    updatedAt: 1,
  };

  test('drafting, filing, a failure for good and recovery each report back on the entry', async () => {
    const { runner, dispatched, commandIds } = setup((state) => {
      state.feedback.f1 = { ...ENTRY, id: 'f1', status: 'drafting', title: null, body: null };
      state.feedback.f2 = { ...ENTRY, id: 'f2', status: 'filing' };
      state.feedback.f3 = { ...ENTRY, id: 'f3', status: 'draft' };
    });
    const draft = createContext();
    await runner.apply({ kind: 'feedback.draft', feedbackId: 'f1' }, draft);
    await runner.apply({ kind: 'feedback.file', feedbackId: 'f3' }, createContext());
    await runner.reportExhausted({ kind: 'feedback.file', feedbackId: 'f3' }, 'gh is missing', 'file-key');
    await runner.recover();
    expect(dispatched).toEqual([
      { type: 'feedback.record_failure', feedbackId: 'f1', detail: NO_DRAFT },
      { type: 'feedback.record_failure', feedbackId: 'f3', detail: 'gh is missing' },
      { type: 'feedback.record_failure', feedbackId: 'f2', detail: STOPPED_WHILE_FILING },
    ]);
    expect(commandIds.slice(0, 2)).toEqual([
      `${draft.key}:feedback.record_failure`,
      'file-key:feedback.record_failure',
    ]);
  });
});

describe('triage', () => {
  test('a settled, unknown or already triaged task is left alone', async () => {
    const { runner, dispatched } = setup((state) => {
      state.tasks.done = createTask({ id: 'done', stage: 'cancelled', branch: null });
      state.tasks.triaged = createTask({ id: 'triaged' });
    });
    for (const taskId of ['done', 'triaged', 'missing']) {
      await runner.apply({ kind: 'task.triage', taskId }, createContext());
    }
    expect(dispatched).toEqual([]);
  });

  test('a triage that gives no answer is an error', async () => {
    const { runner } = setup(withTask({ branch: null, size: null, stage: 'triage', repoId: null }), {
      config: { roots: [createTempDir()] },
      triage: () => Effect.succeed(null),
    });
    await expect(runner.apply({ kind: 'task.triage', taskId: 'task-1' }, createContext())).rejects.toThrow(
      'Shinsa could not read the request'
    );
  });

  test('a request that needs no repository registers none and is triaged without one', async () => {
    const { root } = await createGitRepo();
    const config = createTestConfig(createTempDir(), { roots: [root] });
    const eventLog = openEventLog(config.databasePath);
    const engine = new Engine(eventLog);
    await engine.dispatch({ type: 'task.create', request: 'Hey', repoId: null, mode: 'ask' });
    const [task] = Object.values(engine.state.tasks);
    const runner = new EffectRunner(engine, config, createRuns().runs, createBriefings().briefings, {
      shares: NO_SHARES,
      previews: NO_PREVIEWS,
      handoffs: NO_HANDOFFS,
      resolveLogin: () => Promise.resolve(null),
      triage: (state, current, local) =>
        resolveTriageEffect(state, current, local, <T>() =>
          Effect.succeed({ title: 'Hey', repo: 'none', size: 'small', branch: 'chore/hey' } as T)
        ),
    });
    const context = createContext();
    await runner.apply({ kind: 'task.triage', taskId: task?.id ?? '' }, context);
    expect(eventLog.selectReceipt(`${context.key}:repo.register`)).toBeNull();
    expect(engine.state.repos).toEqual({});
    expect(engine.state.tasks[task?.id ?? '']).toMatchObject({
      repoId: null,
      worktreePath: null,
      stage: 'answering',
    });
    await runner.stop();
    engine.stop();
    await engine.settle();
  });

  test('the repository is registered and the task triaged with its dependencies, each under the effect’s key', async () => {
    const { root } = await createGitRepo();
    const config = createTestConfig(createTempDir(), { roots: [root] });
    const eventLog = openEventLog(config.databasePath);
    const engine = new Engine(eventLog);
    await engine.dispatch({ type: 'task.create', request: 'Earlier work', repoId: null });
    await engine.dispatch({ type: 'task.create', request: 'Fix the button', repoId: null });
    const [dependency, task] = Object.values(engine.state.tasks);
    const { runs } = createRuns();
    const runner = new EffectRunner(engine, config, runs, createBriefings().briefings, {
      shares: NO_SHARES,
      previews: NO_PREVIEWS,
      handoffs: NO_HANDOFFS,
      resolveLogin: () => Promise.resolve(null),
      triage: (_state, _task, local) =>
        Effect.succeed({
          title: 'Fix the button',
          repoPath: local[0]?.path ?? '',
          size: 'small',
          branch: 'fix/button',
          waitsOn: dependency ? [dependency] : [],
        }),
    });
    const context = createContext();
    await runner.apply({ kind: 'task.triage', taskId: task?.id ?? '' }, context);
    expect(eventLog.selectReceipt(`${context.key}:repo.register`)).toMatchObject({ status: 'accepted' });
    expect(eventLog.selectReceipt(`${context.key}:task.triage`)).toMatchObject({ status: 'accepted' });
    const triaged = engine.state.tasks[task?.id ?? ''];
    expect(triaged).toMatchObject({
      title: 'Fix the button',
      branch: 'fix/button',
      waitsOn: [dependency?.id],
    });
    expect(Object.values(engine.state.repos).map((repo) => repo.name)).toEqual(['app']);
  });

  test('a task triage stacks is triaged onto the open change it names, in the same repository', async () => {
    const { root } = await createGitRepo();
    const config = createTestConfig(createTempDir(), { roots: [root] });
    const eventLog = openEventLog(config.databasePath);
    const engine = new Engine(eventLog);
    await engine.dispatch({ type: 'task.create', request: 'Rewrite the store', repoId: null });
    await engine.dispatch({
      type: 'task.create',
      request: 'Move the readers onto the new store',
      repoId: null,
    });
    const [parent, task] = Object.values(engine.state.tasks);
    const { runs } = createRuns();
    const runner = new EffectRunner(engine, config, runs, createBriefings().briefings, {
      shares: NO_SHARES,
      previews: NO_PREVIEWS,
      handoffs: NO_HANDOFFS,
      resolveLogin: () => Promise.resolve(null),
      triage: (_state, triaging, local) =>
        Effect.succeed({
          title: triaging.request,
          repoPath: local[0]?.path ?? '',
          size: 'small',
          branch: triaging.id === parent?.id ? 'refactor/store' : 'refactor/store-readers',
          waitsOn: [],
          ...(triaging.id === task?.id && parent ? { stacksOn: [parent] } : {}),
        }),
    });
    await runner.apply({ kind: 'task.triage', taskId: parent?.id ?? '' }, createContext());
    await runner.apply({ kind: 'task.triage', taskId: task?.id ?? '' }, createContext());
    expect(engine.state.tasks[task?.id ?? '']?.stacksOn).toEqual([parent?.id ?? '']);
    expect(engine.state.tasks[parent?.id ?? '']?.stacksOn ?? []).toEqual([]);
  });

  test('a repository outside the task’s project is bound while the task keeps its project, and filed by its owner', async () => {
    const { root } = await createGitRepo();
    const config = createTestConfig(createTempDir(), { roots: [root] });
    const engine = new Engine(openEventLog(config.databasePath));
    await engine.dispatch({ type: 'project.write', project: { name: 'Shinsa', color: 'blue' } });
    const [project] = Object.values(engine.state.projects);
    const projectId = project?.id ?? '';
    await engine.dispatch({
      type: 'repo.register',
      repo: { name: 'shinsa', path: '/code/shinsa', defaultBranch: 'main', remote: null, checkCommands: [] },
      projectName: null,
      projectId,
    });
    await engine.dispatch({ type: 'task.create', request: 'Fix the button in app', repoId: null, projectId });
    const [task] = Object.values(engine.state.tasks);
    const runner = new EffectRunner(engine, config, createRuns().runs, createBriefings().briefings, {
      shares: NO_SHARES,
      previews: NO_PREVIEWS,
      handoffs: NO_HANDOFFS,
      resolveLogin: () => Promise.resolve(null),
      triage: (state, current, local) =>
        resolveTriageEffect(state, current, local, <T>() =>
          Effect.succeed({ title: 'Fix the button', repo: 'app', size: 'small', branch: 'fix/button' } as T)
        ),
    });
    await runner.apply({ kind: 'task.triage', taskId: task?.id ?? '' }, createContext());
    const app = Object.values(engine.state.repos).find((repo) => repo.name === 'app');
    expect(app?.projectId).not.toBe(projectId);
    expect(engine.state.tasks[task?.id ?? '']).toMatchObject({ repoId: app?.id, projectId });
    await runner.stop();
    engine.stop();
    await engine.settle();
  });

  async function triageNewRepo(options: { roots?: string[]; folders?: string[]; newRepo?: string } = {}) {
    const config = createTestConfig(createTempDir(), { roots: options.roots ?? [] });
    const eventLog = openEventLog(config.databasePath);
    const engine = new Engine(eventLog);
    let projectId: string | null = null;
    if (options.folders) {
      await engine.dispatch({
        type: 'project.write',
        project: { name: 'Islands', color: 'green', folders: options.folders },
      });
      projectId = Object.keys(engine.state.projects)[0] ?? null;
    }
    await engine.dispatch({ type: 'task.create', request: 'Start native-islands', repoId: null, projectId });
    const [task] = Object.values(engine.state.tasks);
    const runner = new EffectRunner(engine, config, createRuns().runs, createBriefings().briefings, {
      shares: NO_SHARES,
      previews: NO_PREVIEWS,
      handoffs: NO_HANDOFFS,
      resolveLogin: () => Promise.resolve(null),
      triage: (state, current, local) =>
        resolveTriageEffect(state, current, local, <T>() =>
          Effect.succeed({
            title: 'Start native-islands',
            repo: 'none',
            new_repo: options.newRepo ?? 'native-islands',
            size: 'large',
            branch: 'feat/start',
          } as T)
        ),
    });
    const context = createContext();
    await runner.apply({ kind: 'task.triage', taskId: task?.id ?? '' }, context);
    const triaged = engine.state.tasks[task?.id ?? ''];
    const close = async () => {
      await runner.stop();
      engine.stop();
      await engine.settle();
    };
    return { engine, eventLog, context, triaged, projectId, close };
  }

  test('a new repository triage names is created in the project’s folder, started, registered there and bound', async () => {
    const folder = createTempDir();
    const { engine, eventLog, context, triaged, projectId, close } = await triageNewRepo({
      folders: [folder],
    });
    const path = join(folder, 'native-islands');
    const repo = Object.values(engine.state.repos).find((candidate) => candidate.name === 'native-islands');
    expect(repo).toMatchObject({ projectId, defaultBranch: expect.any(String) });
    expect(repo?.path.endsWith('/native-islands')).toBe(true);
    expect(triaged).toMatchObject({ repoId: repo?.id, projectId });
    expect(eventLog.selectReceipt(`${context.key}:repo.register`)).toMatchObject({ status: 'accepted' });
    expect(await git(path, 'rev-list', '--count', 'HEAD')).toBe('1');
    await close();
  });

  test('a task in no project gets its new repository in the first folder Shinsa looks in, under the Local project', async () => {
    const root = createTempDir();
    const { engine, triaged, close } = await triageNewRepo({ roots: [root, createTempDir()] });
    const repo = Object.values(engine.state.repos)[0];
    expect(existsSync(join(root, 'native-islands', '.git'))).toBe(true);
    expect(repo?.name).toBe('native-islands');
    expect(engine.state.projects[repo?.projectId ?? '']?.name).toBe('Local');
    expect(triaged?.repoId).toBe(repo?.id);
    await close();
  });

  test('with no folder to create it in, or a folder already taken, the task is triaged without a repository', async () => {
    const logs = captureLogs();
    const nowhere = await triageNewRepo();
    expect(nowhere.triaged?.repoId).toBeNull();
    expect(
      logs.fieldsOf('[Triage] Triage named a new repository, but there is no folder to create it in')
    ).toEqual([{ taskId: nowhere.triaged?.id, name: 'native-islands' }]);
    await nowhere.close();
    const root = createTempDir();
    writeFiles(join(root, 'native-islands'), { 'notes.txt': 'mine' });
    const taken = await triageNewRepo({ roots: [root] });
    expect(taken.triaged?.repoId).toBeNull();
    expect(taken.engine.state.repos).toEqual({});
    expect(logs.fieldsOf('[Triage] Could not create the new repository triage named')).toEqual([
      { taskId: taken.triaged?.id, name: 'native-islands', error: expect.stringContaining('not empty') },
    ]);
    expect(readFileSync(join(root, 'native-islands', 'notes.txt'), 'utf8')).toBe('mine');
    logs.restore();
    await taken.close();
  });

  test('the kind of task and its priority are sent with why triage chose them', async () => {
    const { root } = await createGitRepo();
    const config = createTestConfig(createTempDir(), { roots: [root] });
    const engine = new Engine(openEventLog(config.databasePath));
    await engine.dispatch({ type: 'task.create', request: 'Why is the export slow?', repoId: null });
    const [task] = Object.values(engine.state.tasks);
    const runner = new EffectRunner(engine, config, createRuns().runs, createBriefings().briefings, {
      shares: NO_SHARES,
      previews: NO_PREVIEWS,
      handoffs: NO_HANDOFFS,
      resolveLogin: () => Promise.resolve(null),
      triage: (_state, _task, local) =>
        Effect.succeed({
          title: 'Find why the export is slow',
          repoPath: local[0]?.path ?? '',
          size: 'small',
          branch: 'fix/export-slow',
          waitsOn: [],
          shape: 'investigate',
          priority: 'high',
          reasons: {
            shape: 'It asks for a cause.',
            priority: 'Users are waiting.',
            start: 'Nothing comes first.',
          },
        }),
    });
    await runner.apply({ kind: 'task.triage', taskId: task?.id ?? '' }, createContext());
    expect(engine.state.tasks[task?.id ?? '']).toMatchObject({
      pipeline: ['investigate'],
      priority: 'high',
      triageDecisions: {
        shape: { value: 'investigate', why: 'It asks for a cause.' },
        priority: { value: 'high', why: 'Users are waiting.' },
        start: { value: [], why: 'Nothing comes first.' },
      },
    });
    await runner.stop();
    engine.stop();
    await engine.settle();
  });
});

describe('the setup check', () => {
  test('asks only for what the task’s steps need: a default branch for a worktree', async () => {
    const { repo } = await createGitRepo({ remote: false });
    const broken = { ...repo, defaultBranch: 'trunk' };
    const cases: [Task['pipeline'], string[]][] = [
      [['answer'], []],
      [['research'], []],
      [['investigate'], ['default_branch']],
      [['plan', 'operate'], ['default_branch']],
      [
        ['plan', 'build', 'checks', 'agent_review', 'your_review', 'pull_request', 'merge'],
        ['default_branch'],
      ],
    ];
    for (const [pipeline, kinds] of cases) {
      const { runner, dispatched } = setup(withTask({ stage: 'triage', pipeline }, broken));
      await runner.apply({ kind: 'config.verify', taskId: 'task-1' }, createContext());
      const problems = dispatched.flatMap((command) =>
        command.type === 'config.record' ? command.problems.map((problem): string => problem.kind) : []
      );
      expect(problems).toEqual(kinds);
      expect(dispatched.map((command) => command.type)).toEqual(['config.record']);
    }
    const started = setup(withTask({ stage: 'building' }, broken));
    await started.runner.apply({ kind: 'config.verify', taskId: 'task-1' }, createContext());
    expect(started.dispatched).toEqual([]);
  });

  test('a repository with no commits is started before the check, and only when the work needs a worktree', async () => {
    const root = createTempDir();
    const empty = { ...(await createGitRepo({ remote: false })).repo, path: root };
    const question = setup(withTask({ stage: 'triage', pipeline: ['answer'] }, empty));
    await question.runner.apply({ kind: 'config.verify', taskId: 'task-1' }, createContext());
    expect(question.dispatched).toEqual([
      {
        type: 'config.record',
        taskId: 'task-1',
        problems: [{ kind: 'repository', detail: `${root} is not a git repository.` }],
      },
    ]);
    const change = setup(withTask({ stage: 'triage' }, empty));
    await change.runner.apply({ kind: 'config.verify', taskId: 'task-1' }, createContext());
    expect(change.dispatched).toEqual([
      {
        type: 'config.record',
        taskId: 'task-1',
        problems: [],
        started: { branch: 'main', initialized: true, pushed: false },
      },
    ]);
  });

  test('a task with no repository finds one when its work needs it, and binds it with what its check found', async () => {
    const { repo, root } = await createGitRepo({ remote: false });
    const { path } = await inspectRepo(repo.path);
    const asked: string[] = [];
    const change = withTask(
      { stage: 'triage', repoId: null, pipeline: ['plan', 'operate'] },
      { ...repo, path }
    );
    const found = setup(change, {
      config: { roots: [root] },
      findRepository: (_state, task, local) => {
        asked.push(`${task.id}:${local.map((candidate) => candidate.name).join(',')}`);
        return Effect.succeed(repo.path);
      },
    });
    const context = createContext();
    await found.runner.apply({ kind: 'config.verify', taskId: 'task-1' }, context);
    expect(asked).toEqual(['task-1:app']);
    expect(found.commandIds).toEqual([`${context.key}:config.record`]);
    expect(found.dispatched).toEqual([
      { type: 'config.record', taskId: 'task-1', problems: [], repoId: 'repo-1' },
    ]);

    const none = setup(change, { findRepository: () => Effect.succeed(null) });
    await none.runner.apply({ kind: 'config.verify', taskId: 'task-1' }, createContext());
    expect(none.dispatched).toEqual([{ type: 'config.record', taskId: 'task-1', problems: [] }]);
  });

  test('a question with no repository asks for none, and a moved-on or cancelled check records nothing', async () => {
    const asked: string[] = [];
    const findRepository = () => {
      asked.push('asked');
      return Effect.succeed(null);
    };
    const question = setup(withTask({ stage: 'triage', repoId: null, pipeline: ['answer'] }), {
      findRepository,
    });
    await question.runner.apply({ kind: 'config.verify', taskId: 'task-1' }, createContext());
    expect(question.dispatched).toEqual([{ type: 'config.record', taskId: 'task-1', problems: [] }]);
    const defaults = setup(withTask({ stage: 'triage', repoId: null, pipeline: ['plan', 'operate'] }));
    await defaults.runner.apply({ kind: 'config.verify', taskId: 'task-1' }, createContext());
    expect(defaults.dispatched).toHaveLength(1);
    const moved = setup(withTask({ stage: 'answering', repoId: null }), { findRepository });
    await moved.runner.apply({ kind: 'config.verify', taskId: 'task-1' }, createContext());
    const controller = new AbortController();
    controller.abort();
    const cancelled = setup(withTask({ stage: 'triage', repoId: null, pipeline: ['plan', 'operate'] }), {
      findRepository,
    });
    await cancelled.runner.apply(
      { kind: 'config.verify', taskId: 'task-1' },
      createContext(controller.signal)
    );
    expect([...moved.dispatched, ...cancelled.dispatched]).toEqual([]);
    expect(asked).toEqual([]);
  });

  test('a cancelled setup check stops the fetch it runs and records nothing', async () => {
    const { repo } = await createGitRepo();
    const readPid = await useHangingFetch(repo.path);
    const { runner, dispatched } = setup(withTask({ stage: 'triage' }, { ...repo, defaultBranch: 'trunk' }));
    const controller = new AbortController();
    const running = runner.apply(
      { kind: 'config.verify', taskId: 'task-1' },
      createContext(controller.signal)
    );
    await until('the fetch to start', () => readPid() > 0);
    controller.abort();
    await running;
    await until('the fetch to stop', () => !isRunning(readPid()));
    expect(dispatched).toEqual([]);
  });
});

describe('worktrees', () => {
  test('a worktree is made for a triaged task under the effect’s own id, and anything else is skipped', async () => {
    const { repo } = await createGitRepo();
    const { runner, dispatched, commandIds } = setup(withTask({ stage: 'triage', worktreePath: null }, repo));
    const context = createContext();
    await runner.apply({ kind: 'worktree.create', taskId: 'task-1' }, context);
    expect(dispatched[0]).toMatchObject({
      type: 'worktree.ready',
      taskId: 'task-1',
      branch: 'fix/tab-scroll',
    });
    expect(commandIds).toEqual([`${context.key}:worktree.ready`]);
    const skipped = setup(withTask({ stage: 'building' }, repo));
    await skipped.runner.apply({ kind: 'worktree.create', taskId: 'task-1' }, createContext());
    expect(skipped.dispatched).toEqual([]);
    const missing = setup();
    await expect(
      missing.runner.apply({ kind: 'worktree.create', taskId: 'task-1' }, createContext())
    ).rejects.toThrow('no longer exists');
  });

  test('a released task resets its untouched worktree; one with work keeps it', async () => {
    const { repo, worktree } = await createShippingRepo();
    writeFiles(worktree, { 'stray.txt': 'x' });
    const fresh = setup(withTask({ stage: 'triage', worktreePath: worktree }, repo));
    await fresh.runner.apply({ kind: 'worktree.create', taskId: 'task-1' }, createContext());
    expect(existsSync(join(worktree, 'stray.txt'))).toBe(false);
    expect(fresh.dispatched[0]).toMatchObject({ type: 'worktree.ready', path: worktree });
    writeFiles(worktree, { 'kept.txt': 'x' });
    const worked = setup(
      withTask({ stage: 'triage', worktreePath: worktree, phaseReports: [{}] as Task['phaseReports'] }, repo)
    );
    await worked.runner.apply({ kind: 'worktree.create', taskId: 'task-1' }, createContext());
    expect(existsSync(join(worktree, 'kept.txt'))).toBe(true);
  });

  test('a later round keeps the worktree’s commits and drops only the scratch edits left in it', async () => {
    const { repo, worktree } = await createShippingRepo();
    writeFiles(worktree, { 'scratch.txt': 'x' });
    const rounds = [
      createRound({ number: 1, status: 'merged' }),
      createRound({ number: 2, status: 'active', shipping: 'onto_pull_request' }),
    ];
    const { runner, dispatched } = setup(withTask({ stage: 'triage', worktreePath: worktree, rounds }, repo));
    await runner.apply({ kind: 'worktree.create', taskId: 'task-1' }, createContext());
    expect(existsSync(join(worktree, 'scratch.txt'))).toBe(false);
    expect(existsSync(join(worktree, 'a.txt'))).toBe(true);
    expect(dispatched[0]).toMatchObject({ type: 'worktree.ready', path: worktree });
  });

  test('a cancelled worktree set-up stops the fetch it runs and reports no worktree', async () => {
    const { repo } = await createGitRepo();
    const readPid = await useHangingFetch(repo.path);
    const { runner, dispatched } = setup(withTask({ stage: 'triage', worktreePath: null }, repo));
    const controller = new AbortController();
    const running = runner.apply(
      { kind: 'worktree.create', taskId: 'task-1' },
      createContext(controller.signal)
    );
    await until('the fetch to start', () => readPid() > 0);
    controller.abort();
    await running;
    await until('the fetch to stop', () => !isRunning(readPid()));
    expect(dispatched).toEqual([]);
  });

  test('removing a worktree removes its delegations’ checkouts too, and a failure there is only logged', async () => {
    const { repo, worktree } = await createShippingRepo();
    const { runner, config, dispatched } = setup(withTask({ worktreePath: worktree }, repo));
    mkdirSync(join(config.worktreesDir, 'delegations'), { recursive: true });
    writeFileSync(join(config.worktreesDir, 'delegations', 'task-1'), 'not a folder');
    const logs = captureLogs();
    await runner.apply({ kind: 'worktree.remove', taskId: 'task-1' }, createContext());
    expect(logs.fieldsOf('[Effects] Could not remove the checkouts of delegations')).toContainEqual({
      taskId: 'task-1',
      error: expect.stringContaining('ENOTDIR'),
    });
    logs.restore();
    expect(dispatched).toEqual([{ type: 'worktree.gone', taskId: 'task-1' }]);
  });

  test('removing a worktree stops what still runs in it, but not your own terminals there', async () => {
    const { repo, worktree } = await createShippingRepo();
    const server = Bun.spawn(['sh', '-c', 'sleep 30; true'], {
      cwd: worktree,
      stdout: 'ignore',
      stderr: 'ignore',
    });
    const shell = Bun.spawn(['sh', '-c', 'sleep 30; true'], {
      cwd: worktree,
      stdout: 'ignore',
      stderr: 'ignore',
    });
    const services = { closeTaskTerminals: () => Effect.void, listTerminalPids: Effect.succeed([shell.pid]) };
    const { runner, dispatched } = setup(withTask({ worktreePath: worktree }, repo), { services });
    await runner.apply({ kind: 'worktree.remove', taskId: 'task-1' }, createContext());
    expect(await server.exited).not.toBe(0);
    expect(shell.exitCode).toBeNull();
    expect(existsSync(worktree)).toBe(false);
    expect(dispatched).toEqual([{ type: 'worktree.gone', taskId: 'task-1' }]);
    shell.kill('SIGKILL');
    await shell.exited;
  });

  test('removing a worktree prunes the shared build caches, and a failure there is only logged', async () => {
    const { repo, worktree } = await createShippingRepo();
    const { runner, config } = setup(withTask({ worktreePath: worktree }, repo));
    mkdirSync(join(config.dataDir, 'caches', 'removed-repo'), { recursive: true });
    await runner.apply({ kind: 'worktree.remove', taskId: 'task-1' }, createContext());
    expect(existsSync(join(config.dataDir, 'caches', 'removed-repo'))).toBe(false);
    const broken = setup(withTask({ worktreePath: createTempDir() }, repo));
    writeFileSync(join(broken.config.dataDir, 'caches'), '');
    const logs = captureLogs();
    await broken.runner.apply({ kind: 'worktree.remove', taskId: 'task-1' }, createContext());
    expect(logs.fieldsOf('[Effects] Could not prune the shared build caches')).toContainEqual({
      error: expect.stringContaining('ENOTDIR'),
    });
    logs.restore();
  });

  test('removing a worktree reports it gone even when git cannot remove it', async () => {
    const { repo, worktree } = await createShippingRepo();
    const closed: string[] = [];
    const services = {
      closeTaskTerminals: (taskId: string) => Effect.sync(() => void closed.push(taskId)),
      listTerminalPids: Effect.succeed([]),
    };
    const { runner, dispatched, commandIds } = setup(withTask({ worktreePath: worktree }, repo), {
      services,
    });
    const context = createContext();
    await runner.apply({ kind: 'worktree.remove', taskId: 'task-1' }, context);
    expect(existsSync(worktree)).toBe(false);
    expect(closed).toEqual(['task-1']);
    expect(commandIds).toEqual([`${context.key}:worktree.gone`]);
    const failing = {
      mode: 'worktrees',
      remove: () => Effect.fail(new GitFailed({ message: 'Device busy', retryable: false })),
    };
    const workspaces = {
      resolve: () => failing,
      root: { path: Effect.succeed(createTempDir()) },
    } as unknown as Workspaces['Service'];
    const broken = setup(withTask({ worktreePath: createTempDir() }, repo), { workspaces });
    const logs = captureLogs();
    await broken.runner.apply({ kind: 'worktree.remove', taskId: 'task-1' }, createContext());
    expect(logs.fieldsOf('[Effects] Could not remove a worktree')).toContainEqual({
      taskId: 'task-1',
      error: expect.stringContaining('Device busy'),
    });
    logs.restore();
    const none = setup(withTask({ worktreePath: null }));
    await none.runner.apply({ kind: 'worktree.remove', taskId: 'task-1' }, createContext());
    expect([...dispatched, ...broken.dispatched, ...none.dispatched]).toEqual([
      { type: 'worktree.gone', taskId: 'task-1' },
      { type: 'worktree.gone', taskId: 'task-1' },
    ]);
  });
});

describe('scratch folders', () => {
  function writeScratch(dataDir: string) {
    const scratch = resolveScratchPath(dataDir, 'task-1');
    mkdirSync(join(scratch, 'notes'), { recursive: true });
    writeFileSync(join(scratch, 'notes', 'answer.md'), 'x');
    return scratch;
  }

  test('a settled task’s scratch folder is removed once its runs stop, and removing it again is harmless', async () => {
    for (const stage of ['done', 'merged', 'cancelled'] as const) {
      const closed: string[] = [];
      const services = {
        closeTaskTerminals: (taskId: string) => Effect.sync(() => void closed.push(taskId)),
        listTerminalPids: Effect.succeed([]),
      };
      const { runner, config, calls, dispatched } = setup(withTask({ stage, repoId: null }), { services });
      const scratch = writeScratch(config.dataDir);
      await runner.apply({ kind: 'scratch.remove', taskId: 'task-1' }, createContext());
      expect(existsSync(scratch)).toBe(false);
      await runner.apply({ kind: 'scratch.remove', taskId: 'task-1' }, createContext());
      expect(calls).toEqual(['quiesce:task-1', 'quiesce:task-1']);
      expect(closed).toEqual(['task-1', 'task-1']);
      expect(dispatched).toEqual([]);
    }
    const gone = setup();
    await gone.runner.apply({ kind: 'scratch.remove', taskId: 'task-1' }, createContext());
    expect(gone.calls).toEqual(['quiesce:task-1']);
  });

  test('a task reopened before or while its runs stop keeps its scratch folder', async () => {
    const closed: string[] = [];
    const services = {
      closeTaskTerminals: (taskId: string) => Effect.sync(() => void closed.push(taskId)),
      listTerminalPids: Effect.succeed([]),
    };
    const reopened = setup(withTask({ stage: 'answering', repoId: null }), { services });
    const kept = writeScratch(reopened.config.dataDir);
    await reopened.runner.apply({ kind: 'scratch.remove', taskId: 'task-1' }, createContext());
    expect(existsSync(kept)).toBe(true);
    expect(closed).toEqual([]);
    expect(reopened.calls).toEqual([]);

    const stub = createStubEngine(withTask({ stage: 'done', repoId: null }));
    const config = createTestConfig(createTempDir());
    const scratch = writeScratch(config.dataDir);
    const runs = {
      quiesce: () => {
        return Effect.sync(() =>
          stub.update((state) => {
            const task = state.tasks['task-1'];
            if (task) task.stage = 'answering';
          })
        );
      },
    } as unknown as RunSupervisor['Service'];
    const runner = new EffectRunner(stub.engine, config, runs, createBriefings().briefings, {
      shares: NO_SHARES,
      previews: NO_PREVIEWS,
      handoffs: NO_HANDOFFS,
      triage: () => Effect.succeed(null),
    });
    await runner.apply({ kind: 'scratch.remove', taskId: 'task-1' }, createContext());
    expect(existsSync(scratch)).toBe(true);
  });
});

function checksOf(...commands: string[]) {
  return commands.map((command, index) => ({ id: `c${index + 1}`, label: `Check ${index + 1}`, command }));
}

function checksEffect(commands: string[], coverage = false) {
  return { kind: 'checks.run' as const, taskId: 'task-1', round: 1, checks: checksOf(...commands), coverage };
}

describe('checks', () => {
  test('checks run after the agents stop, only while the task is checking, and record once per effect', async () => {
    const { repo, worktree } = await createShippingRepo();
    const { runner, dispatched, calls, commandIds } = setup(
      withTask({ stage: 'checking', worktreePath: worktree }, repo)
    );
    const context = createContext();
    await runner.apply(checksEffect(['test -f a.txt']), context);
    expect(calls).toEqual(['quiesce:task-1']);
    expect(dispatched[0]).toMatchObject({
      type: 'checks.record',
      results: [{ id: 'c1', label: 'Check 1', command: 'test -f a.txt', outcome: 'pass' }],
    });
    expect(commandIds).toEqual([`${context.key}:checks.record`]);
    const tracked = createMonitor().ledger;
    const counted = setup(withTask({ stage: 'checking', worktreePath: worktree }, repo), {
      trackProcess: (taskId, kind, pid) =>
        Effect.tap(tracked.track(taskId, kind, pid), () =>
          Effect.sync(() =>
            expect(Effect.runSync(tracked.listRoots)).toEqual([{ taskId: 'task-1', kind: 'checks', pid }])
          )
        ),
    });
    await counted.runner.apply(checksEffect(['true']), createContext());
    expect(counted.dispatched).toHaveLength(1);
    expect(Effect.runSync(tracked.listRoots)).toEqual([]);
    const idle = setup(withTask({ stage: 'building' }, repo));
    await idle.runner.apply(checksEffect(['true']), createContext());
    expect(idle.dispatched).toEqual([]);
  });

  test('runs exactly the checks of the effect and keeps each output as its own evidence', async () => {
    const { repo, worktree } = await createShippingRepo();
    const { runner, dispatched, config } = setup(
      withTask({ stage: 'checking', worktreePath: worktree }, { ...repo, checkCommands: ['touch repo-ran'] })
    );
    await runner.apply(checksEffect(['echo 4 pass', 'grep -q b a.txt']), createContext());
    expect(existsSync(join(worktree, 'repo-ran'))).toBe(false);
    const record = dispatched[0] as Extract<ShinsaCommand, { type: 'checks.record' }>;
    expect(record.results.map((result) => [result.id, result.outcome])).toEqual([
      ['c1', 'pass'],
      ['c2', 'fail'],
    ]);
    expect(record.outputs?.map((output) => [output.checkId, output.title])).toEqual([
      ['c1', 'Check 1'],
      ['c2', 'Check 2'],
    ]);
    const read = (uri: string) =>
      readFileSync(join(config.evidenceDir, uri.slice('/api/evidence/'.length)), 'utf8');
    expect(read(record.outputs?.[0]?.uri ?? '')).toBe('$ echo 4 pass\nPassed.\n4 pass');
    expect(read(record.outputs?.[1]?.uri ?? '')).toBe('$ grep -q b a.txt\nFailed.\nexit 1');
  });

  test('checks in a Turbo repository share one Turbo cache per repository', async () => {
    const { repo, worktree } = await createShippingRepo();
    writeFileSync(join(worktree, 'turbo.json'), '{}');
    const { runner, dispatched, config } = setup(
      withTask({ stage: 'checking', worktreePath: worktree }, repo)
    );
    const shared = join(config.dataDir, 'caches', repo.id, 'turbo');
    await runner.apply(checksEffect([`test "$TURBO_CACHE_DIR" = '${shared}'`]), createContext());
    expect(dispatched[0]).toMatchObject({ results: [{ outcome: 'pass' }] });
  });

  test('a failure whose errors all fail on the base commit too is noted and does not block; others do', async () => {
    const { repo, worktree } = await createShippingRepo();
    const { runner, dispatched } = setup(
      withTask({ stage: 'checking', worktreePath: worktree, branch: 'fix/tab-scroll' }, repo)
    );
    const named = (script: string, error: string) => `${script} || { echo '${error}'; exit 1; }`;
    const checks = [
      named('test -f missing.txt', 'missing.txt:1: is missing'),
      named('grep -q b a.txt', 'a.txt:1: has no b'),
      'test -f missing.txt',
    ];
    await runner.apply(checksEffect(checks), createContext());
    const record = dispatched[0] as Extract<ShinsaCommand, { type: 'checks.record' }>;
    expect(record.results.map((result) => [result.id, result.outcome, result.note ?? null])).toEqual([
      ['c1', 'fail', 'fails_on_base'],
      ['c2', 'fail', null],
      ['c3', 'fail', null],
    ]);
    expect(record.results[0]?.detail).toStartWith('1 error, all already on the base branch.');
  });

  test('a task whose base cannot be found keeps its failures blocking', async () => {
    const { repo, worktree } = await createShippingRepo();
    const { runner, dispatched } = setup(
      withTask({ stage: 'checking', worktreePath: worktree, branch: null }, repo)
    );
    await runner.apply(checksEffect(['test -f missing.txt']), createContext());
    expect(dispatched[0]).toMatchObject({ results: [{ outcome: 'fail' }] });
    expect((dispatched[0] as { results: { note?: string }[] }).results[0]?.note).toBeUndefined();
  });

  test('the run before review measures the changed lines with the task’s checks; other runs and failures skip it', async () => {
    const { repo, worktree } = await createShippingRepo();
    const report = "mkdir -p coverage && printf 'SF:a.txt\\nDA:1,0\\nend_of_record\\n' > coverage/lcov.info";
    const coverage = { mode: 'custom', command: report, report: 'coverage/lcov.info', format: null } as const;
    const passing = setup(withTask({ stage: 'checking', worktreePath: worktree }, { ...repo, coverage }));
    await passing.runner.apply(checksEffect(['true'], true), createContext());
    expect(passing.dispatched[0]).toMatchObject({
      type: 'checks.record',
      coverage: {
        status: 'measured',
        covered: 0,
        executable: 1,
        files: [{ path: 'a.txt', covered: 0, executable: 1, uncovered: [[1, 1]] }],
      },
    });
    const early = setup(withTask({ stage: 'checking', worktreePath: worktree }, { ...repo, coverage }));
    await early.runner.apply(checksEffect(['true'], false), createContext());
    expect(early.dispatched[0]).not.toHaveProperty('coverage');
    const failing = setup(withTask({ stage: 'checking', worktreePath: worktree }, { ...repo, coverage }));
    await failing.runner.apply(checksEffect(['grep -q b a.txt'], true), createContext());
    expect(failing.dispatched[0]).not.toHaveProperty('coverage');
  });

  test('Auto coverage runs only the tests among the task’s checks and the repository’s', async () => {
    const { repo, worktree } = await createShippingRepo();
    writeFiles(worktree, {
      'package.json': '{}',
      'math.js': 'export function add(a, b) {\n  return a + b;\n}\n',
      'math.test.js':
        "import { test } from 'bun:test';\nimport { add } from './math.js';\ntest('adds', () => { add(1, 2); });\n",
    });
    await git(worktree, 'add', '-A');
    await git(worktree, 'commit', '-q', '-m', 'feat: add');
    const checks = [
      { id: 'c1', label: 'Math', command: 'bun test ./math.test.js', phases: [1], source: 'plan' as const },
    ];
    const { runner, dispatched } = setup(
      withTask(
        { stage: 'checking', worktreePath: worktree, checks },
        { ...repo, checkCommands: ['bunx biome check'] }
      )
    );
    await runner.apply(checksEffect(['true'], true), createContext());
    expect(dispatched[0]).toMatchObject({
      coverage: { status: 'measured', command: expect.stringContaining('./math.test.js') },
    });
  });

  test('coverage that cannot be measured is recorded as unavailable and logged, and the checks go on', async () => {
    const { repo, worktree } = await createShippingRepo();
    const coverage = { mode: 'custom', command: 'true', report: 'coverage/lcov.info', format: null } as const;
    const { runner, dispatched } = setup(
      withTask({ stage: 'checking', worktreePath: worktree }, { ...repo, coverage })
    );
    const logs = captureLogs();
    await runner.apply(checksEffect(['true'], true), createContext());
    expect(logs.fieldsOf('[Coverage] Could not measure the changed lines')).toContainEqual({
      taskId: 'task-1',
      reason: expect.stringContaining('wrote no report'),
    });
    logs.restore();
    expect(dispatched[0]).toMatchObject({
      type: 'checks.record',
      results: [{ outcome: 'pass' }],
      coverage: { status: 'unavailable', command: 'true' },
    });
  });

  test('cancelled checks stop the running commands and record nothing', async () => {
    const { repo, worktree } = await createShippingRepo();
    const { runner, dispatched } = setup(withTask({ stage: 'checking', worktreePath: worktree }, repo));
    const controller = new AbortController();
    const running = runner.apply(
      checksEffect(['touch started && sleep 30', 'sleep 30']),
      createContext(controller.signal)
    );
    await until('the first check to start', () => existsSync(join(worktree, 'started')));
    controller.abort();
    await running;
    expect(dispatched).toEqual([]);
  });
});

async function moveBase(repo: TestRepo, files: Record<string, string>) {
  const other = join(repo.root, 'other');
  await git(repo.root, 'clone', '-q', repo.origin, other);
  writeFiles(other, files);
  await git(other, 'add', '-A');
  await git(other, 'commit', '-q', '-m', 'feat: move main');
  await git(other, 'push', '-q', 'origin', 'main');
}

async function pushBranch(repo: TestRepo, branch: string, files: Record<string, string>) {
  const other = join(repo.root, `other-${branch.replaceAll('/', '-')}`);
  await git(repo.root, 'clone', '-q', repo.origin, other);
  await git(other, 'checkout', '-q', '-b', branch);
  writeFiles(other, files);
  await git(other, 'add', '-A');
  await git(other, 'commit', '-q', '-m', `feat: ${branch}`);
  await git(other, 'push', '-q', 'origin', branch);
}

function writeHook(repo: TestRepo, script: string) {
  writeFiles(repo.path, { '.git/hooks/pre-push': `#!/bin/sh\n${script}\n` });
  chmodSync(join(repo.path, '.git/hooks/pre-push'), 0o755);
}

async function captureFailure(work: Promise<unknown>) {
  try {
    await work;
  } catch (error) {
    return error;
  }
  throw new Error('expected the effect to fail');
}

describe('getting the branch to GitHub', () => {
  test('a branch behind its base gets the base merged in before the push, and each step is shown', async () => {
    useFakeGitHub();
    const shipping = await createShippingRepo();
    await moveBase(shipping, { '.husky/pre-push': 'bun run check-types\n' });
    const { runner, dispatched, commandIds } = setup(
      withTask({ stage: 'shipping', worktreePath: shipping.worktree }, shipping.repo)
    );
    const context = createContext();
    await runner.apply({ kind: 'pull_request.open', taskId: 'task-1' }, context);
    expect(dispatched.slice(0, 2)).toEqual([
      { type: 'pull_request.record_step', taskId: 'task-1', step: { kind: 'updating', base: 'main' } },
      { type: 'pull_request.record_step', taskId: 'task-1', step: { kind: 'pushing', hook: false } },
    ]);
    expect(commandIds[0]).toBe(`${context.key}:1:pull_request.record_step:updating:main`);
    expect(await git(shipping.worktree, 'log', '-1', '--format=%s')).toBe(
      "Merge branch 'main' into fix/tab-scroll"
    );
    const head = await git(shipping.worktree, 'rev-parse', 'HEAD');
    expect(await git(shipping.origin, 'rev-parse', 'refs/heads/fix/tab-scroll')).toBe(head);
    expect(await git(shipping.origin, 'show', 'refs/heads/fix/tab-scroll:.husky/pre-push')).toBe(
      'bun run check-types'
    );
    await runner.stop();
  });

  test('a branch stacked on several tasks gets every parent merged in before the push', async () => {
    useFakeGitHub();
    const shipping = await createShippingRepo();
    await pushBranch(shipping, 'feat/b', { 'b.txt': 'b\n' });
    await pushBranch(shipping, 'feat/c', { 'c.txt': 'c\n' });
    const { runner, dispatched } = setup(
      withTask(
        {
          stage: 'shipping',
          worktreePath: shipping.worktree,
          stacksOn: ['b', 'c'],
          stackBases: ['feat/b', 'feat/c'],
        },
        shipping.repo
      )
    );
    await runner.apply({ kind: 'pull_request.open', taskId: 'task-1' }, createContext());
    expect(dispatched.slice(0, 3)).toEqual([
      { type: 'pull_request.record_step', taskId: 'task-1', step: { kind: 'updating', base: 'feat/b' } },
      { type: 'pull_request.record_step', taskId: 'task-1', step: { kind: 'updating', base: 'feat/c' } },
      { type: 'pull_request.record_step', taskId: 'task-1', step: { kind: 'pushing', hook: false } },
    ]);
    expect(await git(shipping.worktree, 'show', 'HEAD:b.txt')).toBe('b');
    expect(await git(shipping.worktree, 'show', 'HEAD:c.txt')).toBe('c');
    await runner.stop();
  });

  test('a conflict with the second parent of a stacked branch goes to the agent with that parent', async () => {
    useFakeGitHub();
    const shipping = await createShippingRepo();
    await pushBranch(shipping, 'feat/b', { 'b.txt': 'b\n' });
    await pushBranch(shipping, 'feat/c', { 'a.txt': 'theirs\n' });
    const { runner, dispatched } = setup(
      withTask(
        {
          stage: 'shipping',
          worktreePath: shipping.worktree,
          stacksOn: ['b', 'c'],
          stackBases: ['feat/b', 'feat/c'],
        },
        shipping.repo
      )
    );
    await runner.apply({ kind: 'pull_request.open', taskId: 'task-1' }, createContext());
    expect(dispatched.at(-1)).toEqual({
      type: 'pull_request.record_update_conflict',
      taskId: 'task-1',
      base: 'feat/c',
      files: ['a.txt'],
    });
    await runner.stop();
  });

  test('conflicts while updating go to the agent with the files, and nothing is pushed', async () => {
    const readGitHub = useFakeGitHub();
    const shipping = await createShippingRepo();
    await moveBase(shipping, { 'a.txt': 'theirs\n' });
    const { runner, dispatched } = setup(
      withTask({ stage: 'shipping', worktreePath: shipping.worktree }, shipping.repo)
    );
    await runner.apply({ kind: 'pull_request.open', taskId: 'task-1' }, createContext());
    expect(dispatched).toEqual([
      { type: 'pull_request.record_step', taskId: 'task-1', step: { kind: 'updating', base: 'main' } },
      { type: 'pull_request.record_update_conflict', taskId: 'task-1', base: 'main', files: ['a.txt'] },
    ]);
    expect(await git(shipping.worktree, 'status', '--porcelain')).toBe('');
    expect(await git(shipping.origin, 'branch', '--list', 'fix/tab-scroll')).toBe('');
    expect(readGitHub().calls).toEqual([]);
    await runner.stop();
  });

  test('a pre-push hook that fails goes to the agent with its output and failures, and is never retried', async () => {
    const readGitHub = useFakeGitHub();
    const shipping = await createShippingRepo();
    writeHook(shipping, 'echo "src/a.ts(3,1): error TS2322: Type \'string\' is not assignable."\nexit 1');
    const { runner, dispatched } = setup(
      withTask({ stage: 'shipping', worktreePath: shipping.worktree }, shipping.repo)
    );
    await runner.apply({ kind: 'pull_request.open', taskId: 'task-1' }, createContext());
    expect(dispatched[0]).toEqual({
      type: 'pull_request.record_step',
      taskId: 'task-1',
      step: { kind: 'pushing', hook: true },
    });
    expect(dispatched[1]).toMatchObject({
      type: 'pull_request.record_hook_failure',
      taskId: 'task-1',
      output: expect.stringContaining("error TS2322: Type 'string' is not assignable."),
      failures: ["src/a.ts: TS2322 Type 'string' is not assignable."],
    });
    expect(dispatched).toHaveLength(2);
    expect(await git(shipping.origin, 'branch', '--list', 'fix/tab-scroll')).toBe('');
    expect(readGitHub().calls).toEqual([]);
    await runner.stop();
  });

  test('a hook failure it cannot read is still the agent’s, with no failures named', async () => {
    useFakeGitHub();
    const shipping = await createShippingRepo();
    writeHook(shipping, 'echo "something went wrong"\nexit 1');
    const { runner, dispatched } = setup(
      withTask({ stage: 'shipping', worktreePath: shipping.worktree }, shipping.repo)
    );
    await runner.apply({ kind: 'pull_request.open', taskId: 'task-1' }, createContext());
    expect(dispatched[1]).toMatchObject({ type: 'pull_request.record_hook_failure', failures: null });
    await runner.stop();
  });

  test('a remote it cannot reach fails the effect to be retried in 30s, and the retry names the step and why', async () => {
    useFakeGitHub();
    const shipping = await createShippingRepo();
    await git(shipping.path, 'remote', 'set-url', 'origin', 'https://127.0.0.1:1/acme/app.git');
    const { runner, dispatched, commandIds } = setup(
      withTask({ stage: 'shipping', worktreePath: shipping.worktree }, shipping.repo),
      { config: { pushRetryMs: 30_000 } }
    );
    const error = await captureFailure(
      runner.apply({ kind: 'pull_request.open', taskId: 'task-1' }, createContext())
    );
    expect(error).toBeInstanceOf(ShippingFailed);
    expect(error).toMatchObject({ step: 'updating', retryable: true, delayMs: 30_000 });
    await runner.reportRetry(
      { kind: 'pull_request.open', taskId: 'task-1' },
      { attempt: 1, attempts: 5, retryAt: 40_000, failure: error as ShippingFailed },
      'open-key'
    );
    expect(dispatched.at(-1)).toMatchObject({
      type: 'pull_request.record_retry',
      taskId: 'task-1',
      step: 'updating',
      attempt: 1,
      attempts: 5,
      retryAt: 40_000,
      detail: expect.stringMatching(/^Failed to connect to 127\.0\.0\.1 port 1/),
    });
    expect(commandIds.at(-1)).toBe('open-key:1:pull_request.record_retry');
    await runner.stop();
  });

  test('a branch someone else moved on the remote fails at once with what to do; other retries are reported as pushes', async () => {
    useFakeGitHub();
    const shipping = await createShippingRepo();
    await git(shipping.worktree, 'push', '-q', 'origin', 'HEAD:refs/heads/fix/tab-scroll');
    await git(shipping.worktree, 'commit', '-q', '--amend', '-m', 'fix: a, again');
    const { runner, dispatched } = setup(
      withTask({ stage: 'shipping', worktreePath: shipping.worktree, pullRequest: PULL }, shipping.repo)
    );
    const error = await captureFailure(
      runner.apply({ kind: 'pull_request.push', taskId: 'task-1' }, createContext())
    );
    expect(error).toMatchObject({ step: 'pushing', retryable: false });
    expect((error as Error).message).toStartWith(
      'The branch on the remote has commits this branch does not have'
    );

    const count = dispatched.length;
    await runner.reportRetry(
      { kind: 'pull_request.merge', taskId: 'task-1', headSha: null },
      retryOf(new Error('x')),
      'k'
    );
    expect(dispatched).toHaveLength(count);
    await runner.reportRetry(
      { kind: 'pull_request.push', taskId: 'task-1' },
      retryOf(new EffectFailed({ message: 'boom', detail: 'boom', retryable: true, delayMs: null })),
      'k'
    );
    expect(dispatched.at(-1)).toMatchObject({ step: 'pushing', detail: 'boom' });
    await runner.stop();
  });
});

function retryOf(error: unknown) {
  return { attempt: 2, attempts: 5, retryAt: 1, failure: resolveEffectFailure(error) };
}

describe('pull requests', () => {
  test('opening pushes, records the pull request with its comments and syncs it again once CI starts', async () => {
    const readGitHub = useFakeGitHub();
    const { repo, worktree, origin } = await createShippingRepo();
    const { runner, dispatched, commandIds } = setup(
      withTask({ stage: 'shipping', worktreePath: worktree }, repo),
      { config: { settleDelayMs: 10 } }
    );
    const context = createContext();
    await runner.apply({ kind: 'pull_request.open', taskId: 'task-1' }, context);
    const head = await git(worktree, 'rev-parse', 'HEAD');
    expect(await git(origin, 'rev-parse', 'refs/heads/fix/tab-scroll')).toBe(head);
    expect(dispatched.map((command) => command.type)).toEqual([
      'pull_request.record_step',
      'pull_request.record_push',
      'pull_request.record_step',
      'pull_request.record',
    ]);
    expect(commandIds.slice(0, 3)).toEqual([
      `${context.key}:1:pull_request.record_step:pushing`,
      `${context.key}:pull_request.record_push:${head}`,
      `${context.key}:1:pull_request.record_step:opening`,
    ]);
    expect(dispatched[3]).toMatchObject({ remarks: [], viewer: 'shinsa-user' });
    await until('the follow-up sync', () => dispatched.length === 5, GH_WAIT_MS);
    expect(readGitHub().pulls).toHaveLength(1);
    await runner.stop();
  });

  test('pushing without a pull request opens one; with one it pushes and syncs later', async () => {
    useFakeGitHub();
    const { repo, worktree } = await createShippingRepo();
    const first = setup(withTask({ stage: 'shipping', worktreePath: worktree }, repo));
    await first.runner.apply({ kind: 'pull_request.push', taskId: 'task-1' }, createContext());
    expect(first.dispatched.map((command) => command.type)).toEqual([
      'pull_request.record_step',
      'pull_request.record_push',
      'pull_request.record_step',
      'pull_request.record',
    ]);
    await first.runner.stop();
    const logs = captureLogs();
    restores.push(logs.restore);
    const second = setup(withTask({ stage: 'shipping', worktreePath: worktree, pullRequest: PULL }, repo));
    await second.runner.apply({ kind: 'pull_request.push', taskId: 'task-1' }, createContext());
    expect(second.dispatched.map((command) => command.type)).toEqual([
      'pull_request.record_step',
      'pull_request.record_push',
    ]);
    expect(logs.fieldsOf('[GitHub] Could not refresh the pull request description')).toContainEqual(
      expect.objectContaining({ taskId: 'task-1', number: PULL.number })
    );
    await second.runner.stop();
  });

  test('an open or a push cancelled before it pushes pushes nothing and opens nothing', async () => {
    const readGitHub = useFakeGitHub();
    const { repo, worktree, origin } = await createShippingRepo();
    const controller = new AbortController();
    controller.abort();
    for (const kind of ['pull_request.open', 'pull_request.push'] as const) {
      const { runner, dispatched } = setup(withTask({ stage: 'shipping', worktreePath: worktree }, repo));
      await runner.apply({ kind, taskId: 'task-1' }, createContext(controller.signal));
      expect(dispatched).toEqual([]);
    }
    await expect(
      git(origin, 'rev-parse', '--verify', '--quiet', 'refs/heads/fix/tab-scroll')
    ).rejects.toThrow();
    expect(readGitHub().calls).toEqual([]);
  });

  test('without a worktree, or when GitHub returns nothing, opening fails', async () => {
    const { repo } = await createGitRepo();
    for (const kind of ['pull_request.open', 'pull_request.push'] as const) {
      const { runner } = setup(withTask({ worktreePath: null }, repo));
      await expect(runner.apply({ kind, taskId: 'task-1' }, createContext())).rejects.toThrow(
        'The task has no worktree.'
      );
    }
    useFakeGitHub();
    useFailingGh('pr create', 0);
    const shipping = await createShippingRepo();
    const { runner } = setup(withTask({ stage: 'shipping', worktreePath: shipping.worktree }, shipping.repo));
    await expect(
      runner.apply({ kind: 'pull_request.open', taskId: 'task-1' }, createContext())
    ).rejects.toThrow('GitHub did not return');
  });

  test('closing on cancel closes each pull request and reports the ones that failed', async () => {
    const logs = captureLogs();
    restores.push(logs.restore);
    const readGitHub = useFakeGitHub([fakePull('fix/tab-scroll'), fakePull('fix/other', { number: 8 })]);
    const { repo } = await createGitRepo();
    const { runner, dispatched } = setup(withTask({ stage: 'cancelled', pullRequest: PULL }, repo));
    await runner.apply({ kind: 'pull_request.close', taskId: 'task-1', numbers: [7, 9, 8] }, createContext());
    expect(readGitHub().pulls.map((pull) => pull.state)).toEqual(['CLOSED', 'CLOSED']);
    expect(dispatched).toEqual([
      {
        type: 'pull_request.record_closed',
        taskId: 'task-1',
        closed: [7, 8],
        failed: [{ number: 9, detail: expect.any(String) }],
      },
    ]);
    expect(logs.fieldsOf('[Effects] Could not close a pull request')).toContainEqual(
      expect.objectContaining({ number: 9 })
    );
  });

  test('a close cancelled before it starts closes nothing and reports nothing', async () => {
    const readGitHub = useFakeGitHub([fakePull('fix/tab-scroll')]);
    const { repo } = await createGitRepo();
    const { runner, dispatched } = setup(withTask({ stage: 'cancelled', pullRequest: PULL }, repo));
    const controller = new AbortController();
    controller.abort();
    await runner.apply(
      { kind: 'pull_request.close', taskId: 'task-1', numbers: [7] },
      createContext(controller.signal)
    );
    expect(readGitHub().pulls[0]?.state).toBe('OPEN');
    expect(dispatched).toEqual([]);
  });

  test('merging uses the merge method from settings and needs a pull request', async () => {
    const readGitHub = useFakeGitHub([fakePull('fix/tab-scroll')]);
    const { repo } = await createGitRepo();
    const { runner, dispatched, update } = setup(
      withTask({ stage: 'awaiting_merge', pullRequest: PULL }, repo)
    );
    update((state) => {
      state.settings = { ...state.settings, mergeMethod: 'rebase' };
    });
    await runner.apply({ kind: 'pull_request.merge', taskId: 'task-1', headSha: null }, createContext());
    expect(readGitHub().pulls[0]).toMatchObject({ state: 'MERGED', mergedWith: '--rebase' });
    expect(dispatched[0]).toMatchObject({ type: 'pull_request.record', pullRequest: { state: 'merged' } });
    const none = setup(withTask({ pullRequest: null }, repo));
    await expect(
      none.runner.apply({ kind: 'pull_request.merge', taskId: 'task-1', headSha: null }, createContext())
    ).rejects.toThrow('no pull request to merge');
  });

  test('a merge that already went through before a crash is recorded, not attempted again', async () => {
    const readGitHub = useFakeGitHub([
      fakePull('fix/tab-scroll', { state: 'MERGED', mergedWith: '--squash' }),
    ]);
    const { repo } = await createGitRepo();
    const { runner, dispatched } = setup(withTask({ stage: 'awaiting_merge', pullRequest: PULL }, repo));
    await runner.apply({ kind: 'pull_request.merge', taskId: 'task-1', headSha: null }, createContext());
    expect(readGitHub().calls.some((call) => call[0] === 'pr' && call[1] === 'merge')).toBe(false);
    expect(dispatched[0]).toMatchObject({ type: 'pull_request.record', pullRequest: { state: 'merged' } });
  });

  test('a merge GitHub reports as done while the pull request stays open fails, so it is retried', async () => {
    useFakeGitHub([fakePull('fix/tab-scroll')]);
    useFailingGh('pr merge', 0);
    const { repo } = await createGitRepo();
    const { runner } = setup(withTask({ stage: 'awaiting_merge', pullRequest: PULL }, repo));
    await expect(
      runner.apply({ kind: 'pull_request.merge', taskId: 'task-1', headSha: null }, createContext())
    ).rejects.toThrow('GitHub still shows the pull request as open after merging it.');
  });

  test('a pull request GitHub puts in its merge queue is waiting, not a failed merge, and is never queued twice', async () => {
    const readGitHub = useFakeGitHub([fakePull('fix/tab-scroll')], { mergeQueue: true });
    const { repo } = await createGitRepo();
    const { runner, dispatched } = setup(withTask({ stage: 'awaiting_merge', pullRequest: PULL }, repo));
    await runner.apply({ kind: 'pull_request.merge', taskId: 'task-1', headSha: null }, createContext());
    expect(records(dispatched).at(-1)?.pullRequest).toMatchObject({
      state: 'open',
      mergeQueue: { state: 'queued', position: 1 },
    });
    await runner.apply({ kind: 'pull_request.merge', taskId: 'task-1', headSha: null }, createContext());
    expect(readGitHub().calls.filter((call) => call[0] === 'pr' && call[1] === 'merge')).toHaveLength(1);
  });

  test('a merge cancelled before it reaches GitHub never merges', async () => {
    const readGitHub = useFakeGitHub([fakePull('fix/tab-scroll')]);
    const { repo } = await createGitRepo();
    const { runner, dispatched } = setup(withTask({ stage: 'awaiting_merge', pullRequest: PULL }, repo));
    const controller = new AbortController();
    controller.abort();
    await runner.apply(
      { kind: 'pull_request.merge', taskId: 'task-1', headSha: null },
      createContext(controller.signal)
    );
    expect(readGitHub().calls.some((call) => call[1] === 'merge')).toBe(false);
    expect(dispatched).toEqual([]);
  });

  test('merging names the head you approved, and a head that moved since is recorded, never merged', async () => {
    const readGitHub = useFakeGitHub([fakePull('main')]);
    const { repo, path } = await createGitRepo();
    const head = (await git(path, 'rev-parse', 'main')).trim();
    const moved = setup(withTask({ stage: 'awaiting_merge', pullRequest: PULL }, repo));
    await moved.runner.apply(
      { kind: 'pull_request.merge', taskId: 'task-1', headSha: 'c0ffee0' },
      createContext()
    );
    expect(readGitHub().calls.some((call) => call[1] === 'merge')).toBe(false);
    expect(records(moved.dispatched)).toMatchObject([{ pullRequest: { state: 'open', headSha: head } }]);
    const approved = setup(withTask({ stage: 'awaiting_merge', pullRequest: PULL }, repo));
    await approved.runner.apply(
      { kind: 'pull_request.merge', taskId: 'task-1', headSha: head },
      createContext()
    );
    expect(readGitHub().calls.find((call) => call[1] === 'merge')).toEqual([
      'pr',
      'merge',
      '7',
      '--squash',
      '--match-head-commit',
      head,
    ]);
    expect(readGitHub().pulls[0]).toMatchObject({ state: 'MERGED' });
  });

  test('a head that moves between the read and the merge is recorded; any other refusal fails the merge', async () => {
    const readGitHub = useFakeGitHub([fakePull('main')]);
    const { repo, path } = await createGitRepo();
    const head = (await git(path, 'rev-parse', 'main')).trim();
    useGhBefore('pr merge', `git -C "${path}" commit -q --allow-empty -m 'chore: someone else'`);
    const { runner, dispatched } = setup(withTask({ stage: 'awaiting_merge', pullRequest: PULL }, repo));
    await runner.apply({ kind: 'pull_request.merge', taskId: 'task-1', headSha: head }, createContext());
    const moved = (await git(path, 'rev-parse', 'main')).trim();
    expect(records(dispatched)).toMatchObject([{ pullRequest: { state: 'open', headSha: moved } }]);
    expect(readGitHub().pulls[0]).toMatchObject({ state: 'OPEN' });
    useFailingGh('pr merge');
    const refused = setup(withTask({ stage: 'awaiting_merge', pullRequest: PULL }, repo));
    await expect(
      refused.runner.apply({ kind: 'pull_request.merge', taskId: 'task-1', headSha: moved }, createContext())
    ).rejects.toThrow('gh is down');
  });
});

describe('merging a stack of pull requests', () => {
  const STACK = [
    createRound({
      number: 1,
      branch: 'feat/one',
      pullRequest: { number: 7, url: 'https://github.com/acme/app/pull/7', state: 'open', base: 'main' },
    }),
    createRound({
      number: 2,
      branch: 'feat/two',
      base: 'feat/one',
      pullRequest: { number: 8, url: 'https://github.com/acme/app/pull/8', state: 'open', base: 'feat/one' },
    }),
    createRound({ number: 3, status: 'active', branch: 'feat/three', base: 'feat/two' }),
  ];

  function stackedPulls(overrides: Record<number, Record<string, unknown>> = {}) {
    return [
      fakePull('feat/one', { number: 7, ...overrides[7] }),
      fakePull('feat/two', { number: 8, base: 'feat/one', ...overrides[8] }),
      fakePull('feat/three', { number: 9, base: 'feat/two', ...overrides[9] }),
    ];
  }

  function listMerged(calls: string[][]) {
    return calls.filter((call) => call[0] === 'pr' && call[1] === 'merge').map((call) => call[2]);
  }

  async function setupStack() {
    const { repo } = await createGitRepo();
    return setup(
      withTask({ stage: 'awaiting_merge', pullRequest: { ...PULL, number: 9 }, rounds: STACK }, repo)
    );
  }

  test('merges the task’s pull request, then each one below it top down, skipping one already merged', async () => {
    const readGitHub = useFakeGitHub(stackedPulls({ 8: { state: 'MERGED' } }));
    const { runner } = await setupStack();
    await runner.apply({ kind: 'pull_request.merge', taskId: 'task-1', headSha: null }, createContext());
    expect(listMerged(readGitHub().calls)).toEqual(['9', '7']);
    expect(readGitHub().pulls.map((pull) => pull.state)).toEqual(['MERGED', 'MERGED', 'MERGED']);
  });

  test('a pull request below that GitHub leaves open after merging it fails the merge, so it is retried', async () => {
    useFakeGitHub(stackedPulls());
    useFailingGh('pr merge 7', 0);
    const { runner } = await setupStack();
    await expect(
      runner.apply({ kind: 'pull_request.merge', taskId: 'task-1', headSha: null }, createContext())
    ).rejects.toThrow('GitHub still shows pull request #7 below this one as open after merging it.');
  });

  test('pull requests below that GitHub puts in its merge queue are waiting, not a failed merge', async () => {
    const readGitHub = useFakeGitHub(stackedPulls(), { mergeQueue: true });
    const { runner } = await setupStack();
    await runner.apply({ kind: 'pull_request.merge', taskId: 'task-1', headSha: null }, createContext());
    expect(listMerged(readGitHub().calls)).toEqual(['9', '8', '7']);
  });

  test('a stack already in GitHub’s merge queue is never queued twice', async () => {
    const queue = { queue: { state: 'QUEUED', position: 1 } };
    const readGitHub = useFakeGitHub(stackedPulls({ 7: queue, 8: queue, 9: queue }), { mergeQueue: true });
    const { runner } = await setupStack();
    await runner.apply({ kind: 'pull_request.merge', taskId: 'task-1', headSha: null }, createContext());
    expect(listMerged(readGitHub().calls)).toEqual([]);
  });

  test('a cancel between two merges merges nothing more', async () => {
    const readGitHub = useFakeGitHub(stackedPulls());
    const { runner } = await setupStack();
    const controller = new AbortController();
    const release = useHeldGh('pr merge 9');
    const applied = runner.apply(
      { kind: 'pull_request.merge', taskId: 'task-1', headSha: null },
      createContext(controller.signal)
    );
    await until('the first merge', () => readGitHub().pulls[2]?.state === 'MERGED');
    controller.abort();
    await applied;
    release();
    expect(readGitHub().pulls.map((pull) => pull.state)).toEqual(['OPEN', 'OPEN', 'MERGED']);
  });
});

describe('merging a bundle of tasks', () => {
  function bundlePulls(overrides: Record<number, Record<string, unknown>> = {}) {
    return [
      fakePull('feat/root', { number: 7, ...overrides[7] }),
      fakePull('feat/middle', { number: 8, base: 'feat/root', ...overrides[8] }),
      fakePull('feat/top', { number: 9, base: 'feat/middle', ...overrides[9] }),
    ];
  }

  const BUNDLE: BundlePullRequest[] = [
    { taskId: 'task-3', number: 9 },
    { taskId: 'task-2', number: 8 },
  ];

  async function commitBranch(path: string, branch: string, from: string, files: Record<string, string>) {
    await git(path, 'checkout', '-q', '-B', branch, from);
    writeFiles(path, files);
    await git(path, 'add', '-A');
    await git(path, 'commit', '-q', '-m', `feat: ${branch}`);
    await git(path, 'push', '-q', '-f', 'origin', branch);
  }

  async function setupBundle(stage: Task['stage'] = 'awaiting_merge') {
    const created = await createGitRepo({ files: { 'top.txt': 'start\n' } });
    await commitBranch(created.path, 'feat/root', 'main', { 'root.txt': 'root\n' });
    await commitBranch(created.path, 'feat/middle', 'feat/root', { 'middle.txt': 'middle\n' });
    await commitBranch(created.path, 'feat/top', 'feat/middle', { 'top.txt': 'top\n' });
    const ready = { commit: null };
    const result = setup((state) => {
      state.repos['repo-1'] = createRepo(created.repo);
      state.tasks['task-1'] = createTask({
        id: 'task-1',
        title: 'Root',
        branch: 'feat/root',
        stage,
        bundleReady: ready,
        pullRequest: PULL,
      });
      state.tasks['task-2'] = createTask({
        id: 'task-2',
        title: 'Middle',
        branch: 'feat/middle',
        stage,
        stacksOn: ['task-1'],
        stackBases: ['feat/root'],
        bundleReady: ready,
        pullRequest: { ...PULL, number: 8, base: 'feat/root' },
      });
      state.tasks['task-3'] = createTask({
        id: 'task-3',
        title: 'Top',
        branch: 'feat/top',
        stage,
        stacksOn: ['task-2'],
        stackBases: ['feat/middle'],
        bundleReady: ready,
        pullRequest: { ...PULL, number: 9, base: 'feat/middle' },
      });
    });
    return { ...result, created };
  }

  async function moveMain(origin: string, root: string, files: Record<string, string>) {
    const other = join(root, 'other');
    await git(root, 'clone', '-q', origin, other);
    writeFiles(other, files);
    await git(other, 'add', '-A');
    await git(other, 'commit', '-q', '-m', 'feat: move main');
    await git(other, 'push', '-q', 'origin', 'main');
  }

  function listMerged(calls: string[][]) {
    return calls.filter((call) => call[0] === 'pr' && call[1] === 'merge').map((call) => call[2]);
  }

  test('the root merges the bundle from the last pull request back to its own, recording each one', async () => {
    const readGitHub = useFakeGitHub(bundlePulls({ 8: { state: 'MERGED' } }));
    const { runner, dispatched } = await setupBundle();
    await runner.apply(
      { kind: 'pull_request.merge', taskId: 'task-1', headSha: null, bundle: BUNDLE },
      createContext()
    );
    expect(listMerged(readGitHub().calls)).toEqual(['9', '7']);
    expect(
      records(dispatched)
        .filter((record) => record.pullRequest.state === 'merged')
        .map((record) => record.taskId)
    ).toEqual(['task-3', 'task-2', 'task-1']);
  });

  test('a root whose head moved is recorded and merges nothing', async () => {
    const readGitHub = useFakeGitHub(bundlePulls({ 7: { head: 'main' } }));
    const { runner, dispatched } = await setupBundle();
    await runner.apply(
      { kind: 'pull_request.merge', taskId: 'task-1', headSha: 'c0ffee0', bundle: BUNDLE },
      createContext()
    );
    expect(listMerged(readGitHub().calls)).toEqual([]);
    expect(records(dispatched).map((record) => record.taskId)).toEqual(['task-1']);
  });

  test('a branch that conflicts with the default branch once the bundle merges stops the merge before anything merges', async () => {
    const readGitHub = useFakeGitHub(bundlePulls());
    const { runner, created } = await setupBundle();
    await moveMain(created.origin, created.root, { 'top.txt': 'main\n' });
    await expect(
      runner.apply(
        { kind: 'pull_request.merge', taskId: 'task-1', headSha: null, bundle: BUNDLE },
        createContext()
      )
    ).rejects.toThrow('“Top” conflicts with main once the bundle merges, so nothing was merged.');
    expect(listMerged(readGitHub().calls)).toEqual([]);
  });

  test('a task above that GitHub leaves open fails the merge, and the failure goes to the root', async () => {
    useFakeGitHub(bundlePulls());
    useFailingGh('pr merge 8', 0);
    const { runner, dispatched } = await setupBundle();
    const effect = { kind: 'pull_request.merge' as const, taskId: 'task-1', headSha: null, bundle: BUNDLE };
    await expect(runner.apply(effect, createContext())).rejects.toThrow(
      'GitHub still shows the pull request as open after merging it.'
    );
    await runner.reportExhausted(effect, 'GitHub refused.', 'merge-key');
    expect(dispatched.at(-1)).toMatchObject({
      type: 'effect.fail',
      taskId: 'task-1',
      detail: 'GitHub refused.',
    });
  });

  test('a sync of the root checks that the whole bundle merges into the default branch', async () => {
    useFakeGitHub(bundlePulls());
    const { runner, dispatched, created } = await setupBundle('shipping');
    await runner.syncPullRequest('task-1', true);
    expect(dispatched.find((command) => command.type === 'bundle.record_check')).toEqual({
      type: 'bundle.record_check',
      taskId: 'task-1',
      conflict: null,
    });
    await moveMain(created.origin, created.root, { 'top.txt': 'main\n' });
    await runner.syncPullRequest('task-1', true);
    expect(dispatched.filter((command) => command.type === 'bundle.record_check').at(-1)).toEqual({
      type: 'bundle.record_check',
      taskId: 'task-1',
      conflict: { taskId: 'task-3', behindTaskId: 'task-1', base: 'main' },
    });
    await runner.syncPullRequest('task-2', true);
    expect(dispatched.filter((command) => command.type === 'bundle.record_check')).toHaveLength(2);
  });

  test('a bundle check that cannot read a branch logs it and records nothing', async () => {
    useFakeGitHub(bundlePulls());
    const { runner, dispatched, created } = await setupBundle('shipping');
    await git(created.path, 'push', '-q', 'origin', '--delete', 'feat/top');
    const logs = captureLogs();
    try {
      await runner.syncPullRequest('task-1', true);
      expect(
        logs.fieldsOf('[Watch] Could not check that the bundle merges into the default branch')
      ).toHaveLength(1);
    } finally {
      logs.restore();
    }
    expect(dispatched.some((command) => command.type === 'bundle.record_check')).toBe(false);
  });
});

describe('syncing a pull request', () => {
  test('a sync retargets a stale base, a watch effect always records, and unknown tasks are ignored', async () => {
    const readGitHub = useFakeGitHub([fakePull('fix/tab-scroll', { base: 'feat/old' })]);
    const { repo } = await createGitRepo();
    const { runner, dispatched } = setup(
      withTask({ stage: 'shipping', pullRequest: { ...PULL, base: 'feat/old' } }, repo)
    );
    await runner.syncPullRequest('task-1');
    expect(readGitHub().pulls[0]).toMatchObject({ base: 'main' });
    await runner.apply({ kind: 'pull_request.watch', taskId: 'task-1' }, createContext());
    expect(await runner.syncPullRequest('missing')).toBeNull();
    expect(dispatched.map((command) => command.type)).toEqual(['pull_request.record', 'pull_request.record']);
  });

  test('a sync records only news: a changed pull request, a new comment, or a watch that would move', async () => {
    const readGitHub = useFakeGitHub([fakePull('fix/tab-scroll')]);
    const { repo } = await createGitRepo();
    const { runner, dispatched, update } = setup(withTask({ stage: 'shipping', pullRequest: PULL }, repo));
    await runner.syncPullRequest('task-1');
    const [first] = records(dispatched);
    update((state) => {
      const task = state.tasks['task-1'];
      if (!task || !first) return;
      const watch = evaluatePullRequestWatch(
        createPullRequestWatch(1),
        first.pullRequest,
        first.remarks ?? null,
        first.viewer ?? null
      ).next;
      state.tasks['task-1'] = { ...task, pullRequest: first.pullRequest, pullRequestWatch: watch };
    });
    await runner.syncPullRequest('task-1');
    expect(records(dispatched)).toHaveLength(1);
    readGitHub.change((state) => {
      state.pulls[0] = {
        ...state.pulls[0],
        comments: [{ id: 'c1', author: 'bot', createdAt: '2026-02-01T00:00:00Z', body: 'Nit' }],
      };
    });
    await runner.syncPullRequest('task-1');
    expect(records(dispatched)).toHaveLength(2);
    expect(records(dispatched)[1]?.remarks?.map((remark) => remark.id)).toEqual(['c1']);
  });

  test('a read without checks says whether the repository has CI, read once; a read with checks does not ask', async () => {
    const readGitHub = useFakeGitHub([fakePull('fix/tab-scroll', { checks: 'none' })], {
      workflows: { 'test.yml': 'on: pull_request\n' },
    });
    const { repo } = await createGitRepo();
    const { runner, dispatched } = setup(withTask({ stage: 'shipping', pullRequest: null }, repo));
    await runner.syncPullRequest('task-1', true);
    await runner.syncPullRequest('task-1', true);
    expect(records(dispatched).map((command) => command.ci)).toEqual(['workflows', 'workflows']);
    const ciReads = () =>
      readGitHub().calls.filter((call) => call.some((arg) => arg.startsWith('workflows=')));
    expect(ciReads()).toHaveLength(1);
    readGitHub.change((state) => {
      state.pulls[0] = { ...state.pulls[0], checks: 'passing' };
    });
    await runner.syncPullRequest('task-1', true);
    expect(records(dispatched).at(-1)?.ci).toBe('unknown');
    expect(ciReads()).toHaveLength(1);
  });

  test('a read that is otherwise the same is news once the grace window for CI to start has passed', async () => {
    useFakeGitHub([fakePull('fix/tab-scroll', { checks: 'none' })], {
      workflows: { 'test.yml': 'on: pull_request\n' },
    });
    const { repo } = await createGitRepo();
    const { runner, dispatched, update } = setup(withTask({ stage: 'shipping', pullRequest: PULL }, repo));
    await runner.syncPullRequest('task-1');
    const [first] = records(dispatched);
    const settle = (pushedAt: number) =>
      update((state) => {
        const task = state.tasks['task-1'];
        if (!task || !first) return;
        const watch = evaluatePullRequestWatch(
          createPullRequestWatch(1),
          first.pullRequest,
          first.remarks ?? null,
          first.viewer ?? null
        ).next;
        state.tasks['task-1'] = {
          ...task,
          pullRequest: first.pullRequest,
          pullRequestWatch: watch,
          pushedAt,
        };
      });
    settle(Date.now());
    await runner.syncPullRequest('task-1');
    expect(records(dispatched)).toHaveLength(1);
    settle(Date.now() - CI_GRACE_MS);
    await runner.syncPullRequest('task-1');
    expect(records(dispatched)).toHaveLength(2);
  });

  test('a branch with no pull request yet records nothing', async () => {
    useFakeGitHub([fakePull('nothing-matches', { number: 9 })]);
    const { repo } = await createGitRepo();
    const { runner, dispatched } = setup(withTask({ stage: 'shipping', pullRequest: null }, repo));
    expect(await runner.syncPullRequest('task-1')).toBeNull();
    expect(dispatched).toEqual([]);
  });

  test('each failed read is reported to the log; a good read after failures is recorded so the count starts again', async () => {
    const readGitHub = useFakeGitHub([fakePull('fix/tab-scroll')], { failReads: 2 });
    const { repo } = await createGitRepo();
    const { runner, dispatched, update } = setup(withTask({ stage: 'shipping', pullRequest: PULL }, repo));
    const failed = () =>
      dispatched.flatMap((command) => (command.type === 'pull_request.read_failed' ? [command] : []));
    await runner.syncPullRequest('task-1');
    await runner.syncPullRequest('task-1');
    expect(failed()).toEqual([
      {
        type: 'pull_request.read_failed',
        taskId: 'task-1',
        detail: 'gh pr view failed: HTTP 502: Bad Gateway',
      },
      {
        type: 'pull_request.read_failed',
        taskId: 'task-1',
        detail: 'gh pr view failed: HTTP 502: Bad Gateway',
      },
    ]);
    await runner.syncPullRequest('task-1');
    const [first] = records(dispatched);
    update((state) => {
      const task = state.tasks['task-1'];
      if (!task || !first) return;
      const watch = evaluatePullRequestWatch(
        createPullRequestWatch(1),
        first.pullRequest,
        first.remarks ?? null,
        first.viewer ?? null
      ).next;
      state.tasks['task-1'] = { ...task, pullRequest: first.pullRequest, pullRequestWatch: watch };
    });
    await runner.syncPullRequest('task-1');
    expect(records(dispatched)).toHaveLength(1);
    update((state) => {
      const task = state.tasks['task-1'];
      if (task) state.tasks['task-1'] = { ...task, pullRequestReadFailures: 3 };
    });
    await runner.syncPullRequest('task-1');
    expect(records(dispatched)).toHaveLength(2);
    expect(readGitHub().failReads).toBe(0);
  });

  test('a read GitHub refuses for its rate limit is not counted toward giving up', async () => {
    useFakeGitHub([fakePull('fix/tab-scroll')]);
    useFailingGh('pr view', 1, 'API rate limit exceeded for user ID 1.');
    const { repo } = await createGitRepo();
    const { runner, dispatched } = setup(withTask({ stage: 'shipping', pullRequest: PULL }, repo));
    for (let read = 0; read < 3; read += 1) await runner.syncPullRequest('task-1');
    expect(dispatched).toEqual([]);
  });

  test('a retarget GitHub refuses counts as a failed read', async () => {
    useFakeGitHub([fakePull('fix/tab-scroll', { base: 'feat/old' })]);
    useFailingGh('pr edit');
    const { repo } = await createGitRepo();
    const { runner, dispatched } = setup(
      withTask({ stage: 'shipping', pullRequest: { ...PULL, base: 'feat/old' } }, repo)
    );
    expect(await runner.syncPullRequest('task-1')).toBeNull();
    expect(dispatched.map((command) => command.type)).toEqual(['pull_request.read_failed']);
  });
});

describe('watching pull requests', () => {
  test('every shipping task with a live watch is synced on an interval, one sync at a time, until stopped', async () => {
    const readGitHub = useFakeGitHub([fakePull('fix/tab-scroll')]);
    const { repo } = await createGitRepo();
    const { runner, dispatched } = setup(
      (state) => {
        withTask({ stage: 'awaiting_merge' }, repo)(state);
        state.tasks.idle = createTask({ id: 'idle', stage: 'building' });
        state.tasks.stopped = createTask({
          id: 'stopped',
          stage: 'shipping',
          pullRequestWatch: { ...createPullRequestWatch(1), stopped: 'comment_limit' },
        });
      },
      { watchIntervalMs: 20 }
    );
    await Promise.all([runner.recover(), runner.syncAll()]);
    expect(readGitHub().calls.filter((call) => call[1] === 'view')).toHaveLength(1);
    await runner.startWatching();
    await runner.startWatching();
    await until('a watched sync', () => dispatched.length >= 2, GH_WAIT_MS);
    await runner.stop();
    await runner.stop();
  });

  test('a sync that cannot read the opened issues logs it and goes on', async () => {
    useFakeGitHub([], { failIssues: 'HTTP 502' } as Partial<FakeGitHub>);
    const { runner } = setup((state) => {
      state.feedback.f1 = {
        id: 'f1',
        source: 'human',
        note: 'The plan tab hides changes.',
        title: 'Plan tab hides changes',
        body: 'It hides them.',
        status: 'filed',
        failure: null,
        issue: { number: 1, url: 'https://github.com/acme/app/issues/1', openedAt: 1, closedAt: null },
        taskId: null,
        runId: null,
        createdAt: 1,
        updatedAt: 1,
      };
    });
    const logs = captureLogs();
    await runner.syncAll();
    expect(logs.fieldsOf('[Feedback] Could not read the state of opened issues')).toEqual([
      { error: 'gh issue list failed: HTTP 502' },
    ]);
    logs.restore();
  });

  test('stopping aborts the sync in flight and waits for it, so no gh outlives the runner', async () => {
    useFakeGitHub([fakePull('fix/tab-scroll')]);
    const readPid = useHangingGh('pr view');
    const { repo } = await createGitRepo();
    const { runner, dispatched } = setup(withTask({ stage: 'shipping', pullRequest: PULL }, repo));
    const sync = runner.syncAll();
    await until('the read to start', () => readPid() > 0, GH_WAIT_MS);
    await runner.stop();
    await sync;
    expect(isRunning(readPid())).toBe(false);
    expect(dispatched).toEqual([]);
  });

  test('syncs of one task run one after another, so an older read is never recorded over a newer one', async () => {
    const readGitHub = useFakeGitHub([fakePull('fix/tab-scroll', { checks: 'pending' })]);
    const release = useHeldGh('api graphql');
    const { repo } = await createGitRepo();
    const { runner, dispatched } = setup(withTask({ stage: 'shipping', pullRequest: PULL }, repo));
    const spawn = spyOn(Bun, 'spawn');
    restores.push(() => spawn.mockRestore());
    const older = runner.syncPullRequest('task-1');
    await until('the older read', () => readGitHub().calls.some((call) => call[1] === 'graphql'), GH_WAIT_MS);
    readGitHub.change((state) => {
      state.pulls[0] = { ...state.pulls[0], checks: 'passing' };
    });
    const spawned = spawn.mock.calls.length;
    const newer = runner.syncPullRequest('task-1');
    if (spawn.mock.calls.length > spawned) {
      await until('the newer read to be recorded', () => records(dispatched).length === 1, GH_WAIT_MS);
    }
    release();
    await Promise.all([older, newer]);
    expect(records(dispatched).map((record) => record.pullRequest.checks)).toEqual(['pending', 'passing']);
  });

  test('a sync that fails in the background is logged, not thrown', async () => {
    useFakeGitHub([fakePull('fix/tab-scroll')]);
    const { repo, worktree } = await createShippingRepo();
    const logs = captureLogs();
    restores.push(logs.restore);
    const { runner, reject } = setup(
      withTask({ stage: 'shipping', worktreePath: worktree, pullRequest: PULL }, repo),
      { watchIntervalMs: 10, config: { settleDelayMs: 5 } }
    );
    reject((command) => command.type === 'pull_request.record', new Error('engine stopped'));
    await runner.startWatching();
    await runner.apply({ kind: 'pull_request.push', taskId: 'task-1' }, createContext());
    const failed = (taskId?: string) =>
      logs.fieldsOf('[Watch] Pull request sync failed').some((fields) => fields.taskId === taskId);
    await until('the follow-up sync to fail', () => failed('task-1'), GH_WAIT_MS);
    await until('the interval sync to fail', () => failed(undefined), GH_WAIT_MS);
    await runner.stop();
  });
});
