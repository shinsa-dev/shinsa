import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  type Gate,
  listActiveRuns,
  listOpenGates,
  type Run,
  type RunRole,
  type SpecDocument,
  type Task,
} from '@shinsa/core';
import { type ClaudeSession, type ClaudeSessionInput, mapClaudeTool } from '../../src/agents/claude/index.ts';
import { RunSupervisor, Transcripts } from '../../src/agents/index.ts';
import { Briefings } from '../../src/briefing/index.ts';
import type { ServerConfig } from '../../src/config/index.ts';
import { inspectRepo } from '../../src/git/index.ts';
import { EffectRunner, Engine } from '../../src/runtime/index.ts';
import { runCommandOrThrow } from '../../src/shell/index.ts';
import { EventLog, EvidenceStore } from '../../src/store/index.ts';
import { resolveTriage } from '../../src/triage/index.ts';

export const PLAN: SpecDocument = {
  goal: 'Add the two greeting files.',
  plan: [
    { title: 'Write the first file', detail: 'Create a.txt.' },
    { title: 'Write the second file', detail: 'Create b.txt.' },
  ],
  behaviour: ['Both files exist.'],
  approach: 'Write them.',
  files: [],
  outOfScope: [],
  verification: ['The checks pass.'],
  questions: [],
};

interface AgentContext {
  role: RunRole;
  prompt: string;
  cwd: string;
  sessionId: string;
  resumed: boolean;
  signal: AbortSignal;
  steers: string[];
  call: (name: string, input: Record<string, unknown>) => Promise<string>;
  write: (file: string, content: string) => void;
  waitForSteer: () => Promise<string>;
  hang: () => Promise<never>;
}

export type AgentScript = (agent: AgentContext) => Promise<void>;

interface SessionRecord {
  role: RunRole;
  prompt: string;
  resume: string | null;
  sessionId: string;
  model: string | null;
  cwd: string;
  steers: string[];
  cancelled: boolean;
}

const DEFAULT_SCRIPTS: Record<RunRole, AgentScript> = {
  triage: async () => undefined,
  planner: async (agent) => {
    await agent.call('propose_plan', toolPlan(PLAN));
  },
  builder: async (agent) => {
    const match = /builder for phase (\d+)/.exec(agent.prompt);
    const phase = Number(match?.[1] ?? 1);
    agent.write(phase === 1 ? 'a.txt' : `${String.fromCharCode(96 + phase)}.txt`, `phase ${phase}\n`);
    await agent.call('complete_phase', phaseReport(`Wrote the file for phase ${phase}.`));
  },
  reviewer: async (agent) => {
    await agent.call('report_review', { findings: [] });
  },
  fixer: async (agent) => {
    await agent.call('complete_fix', { summary: 'Fixed it.' });
  },
  shipper: async (agent) => {
    await agent.call('complete_fix', { summary: 'Fixed it.' });
  },
};

export function toolPlan(plan: SpecDocument) {
  return {
    goal: plan.goal,
    plan: plan.plan,
    behaviour: plan.behaviour,
    approach: plan.approach,
    files: plan.files,
    out_of_scope: plan.outOfScope,
    verification: plan.verification,
    questions: plan.questions,
  };
}

function phaseReport(summary: string) {
  return {
    summary,
    spots: [{ file: 'a.txt', start: 1, end: 1, attention: 'normal', why: 'The new file.' }],
    decisions: [],
  };
}

class FakeAgents {
  readonly sessions: SessionRecord[] = [];
  readonly #controllers: AbortController[] = [];
  readonly #queued = new Map<RunRole, AgentScript[]>();
  #counter = 0;

  queue(role: RunRole, ...scripts: AgentScript[]) {
    this.#queued.set(role, [...(this.#queued.get(role) ?? []), ...scripts]);
  }

  abortAll() {
    for (const controller of this.#controllers) controller.abort();
  }

  of(role: RunRole) {
    return this.sessions.filter((session) => session.role === role);
  }

  start = (input: ClaudeSessionInput): ClaudeSession => {
    const script = this.#queued.get(input.role)?.shift() ?? DEFAULT_SCRIPTS[input.role];
    const sessionId = input.resume ?? `session-${++this.#counter}`;
    const controller = new AbortController();
    this.#controllers.push(controller);
    const record: SessionRecord = {
      role: input.role,
      prompt: input.prompt,
      resume: input.resume,
      sessionId,
      model: input.model,
      cwd: input.cwd,
      steers: [],
      cancelled: false,
    };
    this.sessions.push(record);
    const steerWaiters: ((text: string) => void)[] = [];
    let finished = false;
    input.onSession(sessionId);
    input.onEntry({ type: 'user', from: 'shinsa', text: input.prompt, attachments: [] });
    const cancelled = new Promise<never>((_, reject) => {
      controller.signal.addEventListener('abort', () => reject(new Error('cancelled')));
    });
    cancelled.catch(() => undefined);
    const agent: AgentContext = {
      role: input.role,
      prompt: input.prompt,
      cwd: input.cwd,
      sessionId,
      resumed: input.resume !== null,
      signal: controller.signal,
      steers: record.steers,
      call: async (name, toolInput) => {
        if (controller.signal.aborted) throw new Error('cancelled');
        input.onEntry({
          type: 'tool_call',
          callId: `${sessionId}-${name}`,
          tool: mapClaudeTool(`mcp__shinsa__${name}`, toolInput),
        });
        const result = await Promise.race([input.handleTool(name, toolInput, controller.signal), cancelled]);
        input.onEntry({
          type: 'tool_result',
          callId: `${sessionId}-${name}`,
          status: 'ok',
          output: result,
          images: [],
        });
        return result;
      },
      write: (file, content) => {
        const path = join(input.cwd, file);
        mkdirSync(resolve(path, '..'), { recursive: true });
        writeFileSync(path, content);
      },
      waitForSteer: () =>
        Promise.race([
          new Promise<string>((resolveSteer) => {
            steerWaiters.push(resolveSteer);
          }),
          cancelled,
        ]),
      hang: () => cancelled,
    };
    const done = (async () => {
      try {
        await script(agent);
        return { outcome: 'completed' as const, summary: 'done' };
      } catch (error) {
        if (controller.signal.aborted) return { outcome: 'cancelled' as const, summary: null };
        return {
          outcome: 'failed' as const,
          summary: error instanceof Error ? error.message : String(error),
        };
      } finally {
        finished = true;
      }
    })();
    return {
      done,
      steer: (text) => {
        if (finished || controller.signal.aborted) return false;
        record.steers.push(text);
        const waiter = steerWaiters.shift();
        if (waiter) waiter(text);
        return true;
      },
      cancel: async () => {
        record.cancelled = true;
        controller.abort();
        await done;
      },
    };
  };
}

export interface FakePullRequest {
  number: number;
  head: string;
  base: string;
  state: 'OPEN' | 'MERGED' | 'CLOSED';
  checks: 'pending' | 'passing' | 'failing' | 'none';
  mergeable: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN';
  unresolved: number;
  mergedWith: string | null;
}

interface GitHubState {
  next: number;
  defaultChecks: FakePullRequest['checks'];
  pulls: FakePullRequest[];
  calls: string[][];
}

export class FakeGitHub {
  readonly path: string;

  constructor(path: string) {
    this.path = path;
    this.#write({ next: 1, defaultChecks: 'pending', pulls: [], calls: [] });
  }

  #read(): GitHubState {
    return JSON.parse(readFileSync(this.path, 'utf8')) as GitHubState;
  }

  #write(state: GitHubState) {
    writeFileSync(this.path, JSON.stringify(state, null, 2));
  }

  get pulls() {
    return this.#read().pulls;
  }

  get calls() {
    return this.#read().calls;
  }

  update(number: number, patch: Partial<FakePullRequest>) {
    const state = this.#read();
    state.pulls = state.pulls.map((pull) => (pull.number === number ? { ...pull, ...patch } : pull));
    this.#write(state);
  }
}

const BIN = resolve(import.meta.dirname, '../helpers/bin');

async function git(cwd: string, ...args: string[]) {
  return runCommandOrThrow(['git', ...args], cwd);
}

export interface Daemon {
  engine: Engine;
  runs: RunSupervisor;
  effects: EffectRunner;
  log: EventLog;
  stop: () => void;
  close: () => Promise<void>;
}

export class World {
  readonly root: string;
  readonly origin: string;
  readonly repoPath: string;
  readonly dataDir: string;
  readonly config: ServerConfig;
  readonly agents = new FakeAgents();
  readonly github: FakeGitHub;
  daemon!: Daemon;
  dependOn: string[] = [];
  live = false;
  readonly #env: Record<string, string | undefined> = {};
  readonly #daemons: Daemon[] = [];

  #track(daemon: Daemon) {
    this.#daemons.push(daemon);
    return daemon;
  }

  private constructor() {
    this.root = mkdtempSync(join(tmpdir(), 'shinsa-e2e-'));
    this.origin = join(this.root, 'origin.git');
    this.repoPath = join(this.root, 'app');
    this.dataDir = join(this.root, 'data');
    for (const dir of ['data', 'data/worktrees', 'data/evidence', 'data/transcripts']) {
      mkdirSync(join(this.root, dir), { recursive: true });
    }
    this.config = {
      dataDir: this.dataDir,
      databasePath: join(this.dataDir, 'shinsa.sqlite'),
      worktreesDir: join(this.dataDir, 'worktrees'),
      evidenceDir: join(this.dataDir, 'evidence'),
      transcriptsDir: join(this.dataDir, 'transcripts'),
      pluginDir: resolve(import.meta.dirname, '../../plugin'),
      webDir: join(this.root, 'web'),
      port: 0,
      hostname: '127.0.0.1',
      allowedHosts: ['localhost', '127.0.0.1', '[::1]'],
      roots: [this.root],
      inspect: false,
      editor: null,
      terminal: 'Terminal',
      settleDelayMs: 3_600_000,
    };
    this.github = new FakeGitHub(join(this.root, 'gh.json'));
  }

  static async create(options: { checks?: string[]; live?: boolean; files?: Record<string, string> } = {}) {
    const world = new World();
    world.live = options.live ?? false;
    const gitConfig = join(world.root, 'gitconfig');
    writeFileSync(
      gitConfig,
      '[user]\n\tname = Shinsa Test\n\temail = test@shinsa.dev\n[init]\n\tdefaultBranch = main\n[commit]\n\tgpgsign = false\n'
    );
    world.#setEnv({
      GIT_CONFIG_GLOBAL: gitConfig,
      GIT_CONFIG_NOSYSTEM: '1',
      PATH: `${BIN}:${Bun.env.PATH ?? ''}`,
      FAKE_GH_STATE: world.github.path,
      FAKE_GH_ORIGIN: world.origin,
      SHINSA_QUICK: options.live ? 'on' : 'off',
    });
    await runCommandOrThrow(['git', 'init', '--bare', '-q', '-b', 'main', world.origin], world.root);
    mkdirSync(world.repoPath);
    await git(world.repoPath, 'init', '-q', '-b', 'main');
    writeFileSync(join(world.repoPath, 'README.md'), '# app\n');
    for (const [file, content] of Object.entries(options.files ?? {})) {
      mkdirSync(resolve(join(world.repoPath, file), '..'), { recursive: true });
      writeFileSync(join(world.repoPath, file), content);
    }
    await git(world.repoPath, 'add', '-A');
    await git(world.repoPath, 'commit', '-q', '-m', 'chore: start');
    await git(world.repoPath, 'remote', 'add', 'origin', world.origin);
    await git(world.repoPath, 'push', '-q', '-u', 'origin', 'main');
    await git(world.repoPath, 'remote', 'set-head', 'origin', 'main');
    world.boot();
    const candidate = await inspectRepo(world.repoPath);
    await world.engine.dispatch({
      type: 'repo.register',
      repo: { ...candidate, checkCommands: [], previewCommand: null },
      areaName: null,
    });
    await world.engine.dispatch({
      type: 'repo.update',
      repoId: world.repoId,
      patch: { checkCommands: options.checks ?? ['test -f a.txt', 'test -f b.txt'] },
    });
    return world;
  }

  #setEnv(values: Record<string, string>) {
    for (const [key, value] of Object.entries(values)) {
      if (!(key in this.#env)) this.#env[key] = process.env[key];
      process.env[key] = value;
    }
  }

  boot() {
    const log = new EventLog(this.config.databasePath);
    const engine = new Engine(log);
    const transcripts = new Transcripts(this.config.transcriptsDir);
    const evidence = new EvidenceStore(this.config.evidenceDir);
    const runs = new RunSupervisor(engine, this.config, transcripts, evidence, {
      startSession: this.live ? undefined : this.agents.start,
    });
    const briefings = new Briefings(engine);
    const effects = new EffectRunner(engine, this.config, runs, briefings, {
      resolveLogin: () => Promise.resolve(null),
      triage: async (state, task, local) => {
        const dependsOn = this.dependOn.flatMap((id) => state.tasks[id] ?? []);
        this.dependOn = [];
        const result = await resolveTriage(state, task, local);
        return result ? { ...result, dependsOn } : result;
      },
    });
    engine.onEffect((effect) => effects.apply(effect));
    engine.onEffectExhausted((effect, error) => effects.reportExhausted(effect, error));
    engine.start();
    this.daemon = this.#track({
      engine,
      runs,
      effects,
      log,
      stop: () => {
        briefings.stop();
        engine.stop();
      },
      close: async () => {
        briefings.stop();
        engine.stop();
        await engine.settle();
        log.close();
      },
    });
    return this.daemon;
  }

  async restart() {
    this.daemon.stop();
    await this.daemon.engine.idle();
    this.boot();
    await this.daemon.runs.recover();
    await this.daemon.effects.recover();
  }

  get engine() {
    return this.daemon.engine;
  }

  get state() {
    return this.daemon.engine.state;
  }

  get repoId() {
    return Object.keys(this.state.repos)[0] ?? '';
  }

  task(taskId: string): Task {
    const task = this.state.tasks[taskId];
    if (!task) throw new Error(`no task ${taskId}`);
    return task;
  }

  gates(taskId: string): Gate[] {
    return listOpenGates(this.state, taskId);
  }

  activeRuns(taskId?: string): Run[] {
    return listActiveRuns(this.state, taskId);
  }

  async createTask(
    intent = 'Add the greeting files',
    options: { priority?: Task['priority']; blockedBy?: string[] } = {}
  ) {
    const before = new Set(Object.keys(this.state.tasks));
    await this.engine.dispatch({
      type: 'task.create',
      intent,
      repoId: this.repoId,
      priority: options.priority,
      blockedBy: options.blockedBy,
    });
    const taskId = Object.keys(this.state.tasks).find((id) => !before.has(id));
    if (!taskId) throw new Error('task was not created');
    return taskId;
  }

  async until(describe: string, predicate: () => boolean, timeoutMs = 15_000) {
    const deadline = Date.now() + timeoutMs;
    while (!predicate()) {
      if (Date.now() > deadline) {
        const tasks = Object.values(this.state.tasks).map(
          (task) =>
            `${task.title}: ${task.stage} (${task.stageReason}) gates=${this.gates(task.id)
              .map((gate) => gate.title)
              .join('|')}`
        );
        throw new Error(`Timed out waiting for ${describe}.\n${tasks.join('\n')}`);
      }
      await Bun.sleep(20);
    }
  }

  async untilStage(taskId: string, stage: Task['stage'], timeoutMs?: number) {
    await this.until(
      `${taskId} to reach ${stage}`,
      () => this.state.tasks[taskId]?.stage === stage,
      timeoutMs
    );
  }

  async untilGate(taskId: string, kind?: Gate['kind'], purpose?: Gate['purpose']) {
    await this.until(`a ${purpose ?? kind ?? 'any'} gate on ${taskId}`, () =>
      this.gates(taskId).some(
        (gate) => (!kind || gate.kind === kind) && (!purpose || gate.purpose === purpose)
      )
    );
    return this.gates(taskId).find(
      (gate) => (!kind || gate.kind === kind) && (!purpose || gate.purpose === purpose)
    ) as Gate;
  }

  async answer(gate: Gate, decision: NonNullable<Gate['decision']>, response: string | null = null) {
    await this.engine.dispatch({ type: 'gate.answer', gateId: gate.id, decision, response });
  }

  async sync(taskId: string) {
    await this.daemon.effects.syncPullRequest(taskId, true);
  }

  async branchLog(branch: string) {
    return (await git(this.repoPath, 'log', '--format=%s', `main..${branch}`)).split('\n').filter(Boolean);
  }

  async remoteBranches() {
    return (await runCommandOrThrow(['git', 'branch', '--format=%(refname:short)'], this.origin)).split('\n');
  }

  async dispose() {
    for (const daemon of this.#daemons) daemon.stop();
    this.agents.abortAll();
    for (const daemon of this.#daemons) await daemon.close();
    for (const [key, value] of Object.entries(this.#env)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(this.root, { recursive: true, force: true });
  }
}
