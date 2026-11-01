import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import {
  type ChatNotice,
  type Gate,
  type GateType,
  listActiveRuns,
  listOpenGates,
  type PlanDocument,
  type Run,
  type RunFailure,
  type RunPurpose,
  type RunRole,
  type ShinsaState,
  type Task,
  type TaskShape,
} from '@shinsa/core';
import { RunSupervisor, type SupervisorOptions, Transcripts } from '../../src/agents/index.ts';
import { CLAUDE_CAPABILITIES, mapClaudeTool } from '../../src/agents/providers/claude/index.ts';
import {
  type AgentProvider,
  type AgentSession,
  type AgentSessionInput,
  ProviderRegistry,
  type SessionArtifactStatus,
} from '../../src/agents/providers/index.ts';
import { createQuickCalls, type QuickJson } from '../../src/agents/quick/index.ts';
import { Briefings } from '../../src/briefing/index.ts';
import type { ServerConfig } from '../../src/config/index.ts';
import { inspectRepo } from '../../src/git/index.ts';
import { EffectRunner, Engine } from '../../src/runtime/index.ts';
import { runCommandOrThrow } from '../../src/shell/index.ts';
import { EventLog, EvidenceStore } from '../../src/store/index.ts';
import { resolveTriage } from '../../src/triage/index.ts';
import { resolveRoundRepository } from '../../src/triage/message.ts';
import { createConfigAt } from '../helpers/config.ts';
import { NO_PREVIEWS, NO_SHARES } from '../helpers/index.ts';

export const PLAN: PlanDocument = {
  goal: 'Add the two greeting files.',
  phases: [
    { title: 'Write the first file', detail: 'Create a.txt.' },
    { title: 'Write the second file', detail: 'Create b.txt.' },
  ],
  behaviour: ['Both files exist.'],
  approach: 'Write them.',
  files: [],
  outOfScope: [],
  verification: [{ label: 'Greeting files', command: 'test -f a.txt', phases: [1, 2] }],
  questions: [],
};

export const IMPACT =
  'Removes the stale greeting files, two at most. The dry run lists them first; restoring them from git undoes it.';

export const AGENT_REPLY = {
  headline: 'Made the change you asked for.',
  points: [{ ask: 'The change', outcome: 'done', note: 'It is in.' }],
};

const IMPACT_REQUIRED = '`impact` is required';

const REPLY_REQUIRED = '`reply` is required';

function callReplying(agent: AgentContext, tool: string, input: Record<string, unknown>) {
  return agent.call(tool, input).catch((error: Error) => {
    if (!error.message.includes(REPLY_REQUIRED)) throw error;
    return agent.call(tool, { ...input, reply: AGENT_REPLY });
  });
}

const NO_CODE = 'this task changes no code';

export type ScriptKey = Exclude<RunRole, 'agent'> | RunPurpose;

export interface AgentContext {
  role: RunRole;
  key: ScriptKey;
  phaseIndex: number | null;
  round: number;
  readOnly: boolean;
  prompt: string;
  cwd: string;
  sessionId: string;
  resumed: boolean;
  signal: AbortSignal;
  steers: string[];
  call: (name: string, input: Record<string, unknown>, requestId?: string) => Promise<string>;
  write: (file: string, content: string) => void;
  waitForSteer: () => Promise<string>;
  hang: () => Promise<never>;
  account: string | null;
  listTools: () => Promise<string[]>;
  notice: (notice: ChatNotice) => void;
  say: (text: string) => void;
}

export class AgentFailure extends Error {
  readonly failure: RunFailure;

  constructor(failure: RunFailure) {
    super(failure.message);
    this.failure = failure;
  }
}

export type AgentScript = (agent: AgentContext) => Promise<void>;

interface SessionRecord {
  role: RunRole;
  key: ScriptKey;
  runId: string | null;
  readOnly: boolean;
  prompt: string;
  resume: string | null;
  fork: boolean;
  sessionId: string;
  model: string | null;
  cwd: string;
  steers: string[];
  cancelled: boolean;
  account: string | null;
}

const DEFAULT_SCRIPTS: Record<ScriptKey, AgentScript> = {
  plan: async (agent) => {
    const plan = agent.prompt.includes(IMPACT_REQUIRED) ? { ...PLAN, impact: IMPACT } : PLAN;
    await callReplying(agent, 'propose_plan', toolPlan(plan)).catch((error: Error) => {
      if (!error.message.includes(NO_CODE)) throw error;
      return callReplying(agent, 'propose_plan', toolPlan({ ...plan, verification: [] }));
    });
  },
  build: async (agent) => {
    const phase = (agent.phaseIndex ?? 0) + 1;
    agent.write(phase === 1 ? 'a.txt' : `${String.fromCharCode(96 + phase)}.txt`, `phase ${phase}\n`);
    await callReplying(agent, 'complete_phase', phaseReport(`Wrote the file for phase ${phase}.`));
  },
  fix: async (agent) => {
    await callReplying(agent, 'complete_fix', { summary: 'Fixed it.' });
  },
  operate: async (agent) => {
    await callReplying(agent, 'report_outcome', { outcome: 'Ran the cleanup script.' });
  },
  watch: async (agent) => {
    await agent.call('report_read', { summary: 'The greeting still renders.' });
  },
  intake: async (agent) => {
    await agent.call('report_read', { summary: 'Read the channel; nothing new to file.' });
  },
  planner: async (agent) => {
    agent.say('Read the code; nothing to add.');
  },
  builder: async (agent) => {
    agent.say('Made the change.');
  },
  reviewer: async (agent) => {
    await agent.call('report_review', { findings: [] });
  },
  answerer: async (agent) => {
    await callReplying(agent, 'answer', { answer: 'It lives in a.txt.' });
  },
  investigator: async (agent) => {
    await callReplying(agent, 'report_diagnosis', { diagnosis: 'The greeting files were never written.' });
  },
  researcher: async (agent) => {
    await callReplying(agent, 'submit_report', { report: 'Plain text files are the simplest option.' });
  },
};

interface Placement {
  key: ScriptKey;
  phaseIndex: number | null;
  round: number;
  runId: string | null;
}

const CONTINUE_MARKER = 'Shinsa restarted while you were working';

const PURPOSE_MARKERS: [RunPurpose, RegExp][] = [
  ['build', /Now build (phase \d+ of|the whole change)/g],
  ['operate', /Now run the operation in the plan/g],
  [
    'fix',
    /The checks failed|The agent review found|The human looked at the work|needs work before the human can merge/g,
  ],
];

function selectAgentRun(state: ShinsaState, input: AgentSessionInput) {
  const live = Object.values(state.runs).filter(
    (run) => run.role === input.role && !run.delegation && run.endedAt === null
  );
  return live.find((run) => state.tasks[run.taskId]?.worktreePath === input.cwd) ?? live.at(-1) ?? null;
}

function readPhaseIndex(prompt: string) {
  const phases = [...prompt.matchAll(/Now build phase (\d+) of/g)];
  const last = phases.at(-1)?.[1];
  return last ? Number(last) - 1 : 0;
}

function readPurpose(prompt: string): RunPurpose {
  let found: RunPurpose = 'build';
  let at = -1;
  for (const [purpose, marker] of PURPOSE_MARKERS) {
    const index = [...prompt.matchAll(marker)].at(-1)?.index ?? -1;
    if (index > at) [found, at] = [purpose, index];
  }
  return found;
}

function readRound(prompt: string) {
  return Number(/This is round (\d+) of the task/.exec(prompt)?.[1] ?? 1);
}

function resolvePlacement(input: AgentSessionInput, run: Run | null, previous: Placement | null): Placement {
  const round = run?.round ?? readRound(input.prompt);
  if (input.role !== 'agent') return { key: input.role, phaseIndex: null, round, runId: null };
  if (run?.purpose) return { key: run.purpose, phaseIndex: run.phaseIndex ?? null, round, runId: run.id };
  if (input.readOnly) return { key: 'plan', phaseIndex: null, round, runId: null };
  if (previous && input.prompt.includes(CONTINUE_MARKER)) return previous;
  const key = readPurpose(input.prompt);
  return { key, phaseIndex: key === 'build' ? readPhaseIndex(input.prompt) : null, round, runId: null };
}

export function toolPlan(plan: PlanDocument) {
  return {
    goal: plan.goal,
    phases: plan.phases,
    behaviour: plan.behaviour,
    approach: plan.approach,
    files: plan.files,
    out_of_scope: plan.outOfScope,
    verification: plan.verification,
    questions: plan.questions,
    ...(plan.impact === undefined ? {} : { impact: plan.impact }),
    ...(plan.operation === undefined ? {} : { operation: plan.operation }),
    ...(plan.evidence === undefined ? {} : { evidence: plan.evidence }),
    ...(plan.approval === undefined ? {} : { approval: plan.approval }),
  };
}

function phaseReport(summary: string) {
  return {
    summary,
    spots: [{ file: 'a.txt', start: 1, end: 1, attention: 'normal', why: 'The new file.' }],
    judgement_calls: [],
  };
}

export class FakeAgents {
  readonly sessions: SessionRecord[] = [];
  readonly lost = new Set<string>();
  readonly #pause: () => number;
  readonly #controllers: AbortController[] = [];
  readonly #queued = new Map<ScriptKey, AgentScript[]>();
  readonly #placements: Map<string, Placement>;
  readonly #memoryPath: string | null;
  #counter = 0;
  state: (() => ShinsaState | null) | null = null;

  constructor(pause: () => number = () => 0, memoryPath: string | null = null) {
    this.#pause = pause;
    this.#memoryPath = memoryPath;
    const remembered =
      memoryPath && existsSync(memoryPath) ? JSON.parse(readFileSync(memoryPath, 'utf8')) : {};
    this.#placements = new Map(Object.entries(remembered as Record<string, Placement>));
  }

  #remember(sessionId: string, placement: Placement) {
    this.#placements.set(sessionId, placement);
    if (!this.#memoryPath) return;
    writeFileSync(`${this.#memoryPath}.tmp`, JSON.stringify(Object.fromEntries(this.#placements)));
    renameSync(`${this.#memoryPath}.tmp`, this.#memoryPath);
  }

  async #wait() {
    const ms = this.#pause();
    if (ms > 0) await Bun.sleep(ms);
  }

  queue(key: ScriptKey, ...scripts: AgentScript[]) {
    this.#queued.set(key, [...(this.#queued.get(key) ?? []), ...scripts]);
  }

  abortAll() {
    for (const controller of this.#controllers) controller.abort();
  }

  inspect = (query: { sessionId: string }): Promise<SessionArtifactStatus> =>
    Promise.resolve(this.lost.has(query.sessionId) ? 'missing' : 'present');

  provider(id: string, label: string): AgentProvider {
    return {
      id,
      label,
      capabilities: CLAUDE_CAPABILITIES,
      startSession: this.start,
      inspectSession: this.inspect,
      listModels: () => Promise.resolve([]),
      complete: () => Promise.resolve(null),
    };
  }

  of(key: ScriptKey) {
    return this.sessions.filter((session) => session.key === key);
  }

  start = (input: AgentSessionInput): AgentSession => {
    const state = input.role === 'agent' ? (this.state?.() ?? null) : null;
    const run = state ? selectAgentRun(state, input) : null;
    const sessionId =
      input.resume && !input.fork ? input.resume : `session-${++this.#counter}-${Bun.randomUUIDv7()}`;
    const placement = resolvePlacement(input, run, this.#placements.get(sessionId) ?? null);
    this.#remember(sessionId, placement);
    const { key } = placement;
    const script = this.#queued.get(key)?.shift() ?? DEFAULT_SCRIPTS[key];
    const controller = new AbortController();
    this.#controllers.push(controller);
    const record: SessionRecord = {
      role: input.role,
      key,
      runId: placement.runId,
      readOnly: input.readOnly,
      prompt: input.prompt,
      resume: input.resume,
      fork: input.fork === true,
      sessionId,
      model: input.model,
      cwd: input.cwd,
      steers: [],
      cancelled: false,
      account: input.account?.id ?? null,
    };
    this.sessions.push(record);
    const steerWaiters: ((text: string) => void)[] = [];
    let finished = false;
    input.onSession(sessionId);
    input.onEntry({ type: 'user', from: 'shinsa', text: input.prompt, attachments: [] });
    const whenCancelled = () =>
      new Promise<never>((_, reject) => {
        if (controller.signal.aborted) {
          reject(new Error('cancelled'));
          return;
        }
        controller.signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true });
      });
    const agent: AgentContext = {
      role: input.role,
      key,
      phaseIndex: placement.phaseIndex,
      round: placement.round,
      readOnly: input.readOnly,
      prompt: input.prompt,
      cwd: input.cwd,
      sessionId,
      resumed: input.resume !== null,
      signal: controller.signal,
      steers: record.steers,
      call: async (name, toolInput, requestId) => {
        await this.#wait();
        if (controller.signal.aborted) throw new Error('cancelled');
        input.onEntry({
          type: 'tool_call',
          callId: `${sessionId}-${name}`,
          tool: mapClaudeTool(`mcp__shinsa__${name}`, toolInput),
        });
        const result = await Promise.race([
          input.tools.handle(name, toolInput, controller.signal, requestId),
          whenCancelled(),
        ]);
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
          whenCancelled(),
        ]),
      hang: whenCancelled,
      account: input.account?.id ?? null,
      listTools: async () => {
        const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
        const client = new Client({ name: 'agent', version: '1.0.0' });
        await input.tools.createServer().connect(serverSide);
        await client.connect(clientSide);
        const { tools } = await client.listTools();
        await client.close();
        return tools.map((tool) => tool.name);
      },
      notice: (notice) => input.onEntry({ type: 'notice', notice }),
      say: (text) => input.onEntry({ type: 'agent', phase: 'final', text }),
    };
    const done = (async () => {
      try {
        await this.#wait();
        await script(agent);
        return { outcome: 'completed' as const, summary: 'done' };
      } catch (error) {
        if (controller.signal.aborted) return { outcome: 'cancelled' as const, summary: null };
        return {
          outcome: 'failed' as const,
          summary: error instanceof Error ? error.message : String(error),
          ...(error instanceof AgentFailure ? { failure: error.failure } : {}),
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
  mergeCommit?: string | null;
  body?: string;
  checkRuns?: { name: string; status: string; conclusion: string | null; required: boolean }[];
}

interface GitHubState {
  next: number;
  defaultChecks: FakePullRequest['checks'];
  pulls: FakePullRequest[];
  calls: string[][];
  workflows?: Record<string, string>;
  repositoryId?: number;
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
    writeFileSync(`${this.path}.tmp`, JSON.stringify(state, null, 2));
    renameSync(`${this.path}.tmp`, this.path);
  }

  get pulls() {
    return this.#read().pulls;
  }

  get calls() {
    return this.#read().calls;
  }

  #change(apply: (state: GitHubState) => GitHubState) {
    const lock = `${this.path}.lock`;
    const deadline = performance.now() + 20_000;
    for (;;) {
      try {
        mkdirSync(lock);
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      }
      if (performance.now() > deadline) throw new Error(`${lock} stayed locked.`);
      Bun.sleepSync(2);
    }
    try {
      this.#write(apply(this.#read()));
    } finally {
      rmSync(lock, { recursive: true, force: true });
    }
  }

  configure(patch: Partial<Pick<GitHubState, 'defaultChecks' | 'workflows' | 'repositoryId'>>) {
    this.#change((state) => ({ ...state, ...patch }));
  }

  update(number: number, patch: Partial<FakePullRequest>) {
    this.#change((state) => ({
      ...state,
      pulls: state.pulls.map((pull) => (pull.number === number ? { ...pull, ...patch } : pull)),
    }));
  }
}

const BIN = resolve(import.meta.dirname, '../helpers/bin');

async function git(cwd: string, ...args: string[]) {
  return runCommandOrThrow(['git', ...args], cwd);
}

interface Daemon {
  engine: Engine;
  runs: RunSupervisor;
  effects: EffectRunner;
  log: EventLog;
  isStopped: () => boolean;
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
  providers: ProviderRegistry | null = null;
  supervise: ((engine: Engine) => Partial<SupervisorOptions>) | null = null;
  dependOn: string[] = [];
  readonly #shapes = new Map<string, TaskShape>();
  classify: QuickJson | null = null;
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
    this.config = createConfigAt(this.root);
    this.github = new FakeGitHub(join(this.root, 'gh.json'));
  }

  static async create(
    options: {
      checks?: string[];
      live?: boolean;
      files?: Record<string, string>;
      providers?: (world: World) => ProviderRegistry;
      supervise?: (world: World, engine: Engine) => Partial<SupervisorOptions>;
    } = {}
  ) {
    const world = new World();
    world.live = options.live ?? false;
    world.providers = options.providers?.(world) ?? null;
    const supervise = options.supervise;
    world.supervise = supervise ? (engine) => supervise(world, engine) : null;
    const gitConfig = join(world.root, 'gitconfig');
    writeFileSync(
      gitConfig,
      '[user]\n\tname = Shinsa Test\n\temail = test@shinsa.dev\n[init]\n\tdefaultBranch = main\n[commit]\n\tgpgsign = false\n'
    );
    const claude = options.live ? Bun.which('claude') : null;
    world.#setEnv({
      GIT_CONFIG_GLOBAL: gitConfig,
      GIT_CONFIG_NOSYSTEM: '1',
      PATH: `${BIN}:${Bun.env.PATH ?? ''}`,
      FAKE_GH_STATE: world.github.path,
      FAKE_GH_ORIGIN: world.origin,
      SHINSA_QUICK: options.live ? 'on' : 'off',
      ...(claude ? { CLAUDE_EXECUTABLE: claude } : {}),
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
      repo: { ...candidate, checkCommands: [] },
      projectName: null,
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
    this.agents.state = () => engine.state;
    const transcripts = new Transcripts(this.config.transcriptsDir);
    const evidence = new EvidenceStore(this.config.evidenceDir);
    const runs = new RunSupervisor(engine, this.config, transcripts, evidence, {
      startSession: this.live || this.providers ? undefined : this.agents.start,
      providers: this.providers ?? undefined,
      ...this.supervise?.(engine),
    });
    const quick = createQuickCalls(this.providers ?? new ProviderRegistry(), () => engine.state.settings);
    const briefings = new Briefings(engine, { ask: quick.write });
    const effects = new EffectRunner(engine, this.config, runs, briefings, {
      shares: NO_SHARES,
      previews: NO_PREVIEWS,
      resolveLogin: () => Promise.resolve(null),
      triage: async (state, task, local) => {
        const waitsOn = this.dependOn.flatMap((id) => state.tasks[id] ?? []);
        const shape = this.#shapes.get(task.request);
        this.dependOn = [];
        const result = await resolveTriage(state, task, local, this.classify ?? quick.classify);
        if (!result || !shape) return result ? { ...result, waitsOn } : result;
        return { ...result, waitsOn, shape, reasons: { ...result.reasons, shape: 'The test chose it.' } };
      },
      findRepository: (state, task, local) =>
        resolveRoundRepository(state, task, local, this.classify ?? quick.classify),
    });
    engine.onEffect((effect, context) => effects.apply(effect, context));
    engine.onEffectExhausted((effect, error, key) => effects.reportExhausted(effect, error, key));
    engine.onEffectRetry((effect, retry, key) => effects.reportRetry(effect, retry, key));
    engine.start();
    let stopped = false;
    this.daemon = this.#track({
      engine,
      runs,
      effects,
      log,
      isStopped: () => stopped,
      stop: () => {
        stopped = true;
        briefings.stop();
        engine.stop();
      },
      close: async () => {
        briefings.stop();
        await effects.stop();
        engine.stop();
        await engine.settle();
        log.close();
      },
    });
    return this.daemon;
  }

  async restartGracefully() {
    await this.daemon.runs.interruptForShutdown();
    this.daemon.stop();
    await this.daemon.engine.settle();
    this.boot();
    await this.daemon.runs.recover();
    await this.daemon.effects.recover();
  }

  async restart() {
    this.daemon.stop();
    await this.daemon.runs.interruptForShutdown();
    await this.daemon.engine.settle();
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
    request = 'Add the greeting files',
    options: { priority?: Task['priority']; waitsOn?: string[]; shape?: TaskShape; forkOf?: string } = {}
  ) {
    const before = new Set(Object.keys(this.state.tasks));
    if (options.shape) this.#shapes.set(request, options.shape);
    await this.engine.dispatch({
      type: 'task.create',
      request,
      repoId: this.repoId,
      priority: options.priority,
      waitsOn: options.waitsOn,
      ...(options.forkOf ? { forkOf: options.forkOf } : {}),
    });
    const taskId = Object.keys(this.state.tasks).find((id) => !before.has(id));
    if (!taskId) throw new Error('task was not created');
    return taskId;
  }

  async until(describe: string, predicate: () => boolean, timeoutMs = 15_000) {
    const deadline = performance.now() + timeoutMs;
    while (!predicate()) {
      if (performance.now() > deadline) {
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

  async untilGate(taskId: string, type?: GateType) {
    await this.until(`a ${type ?? 'any'} gate on ${taskId}`, () =>
      this.gates(taskId).some((gate) => !type || gate.type === type)
    );
    return this.gates(taskId).find((gate) => !type || gate.type === type) as Gate;
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
    const live = this.#daemons.filter((daemon) => !daemon.isStopped());
    await Promise.allSettled(live.map((daemon) => daemon.runs.interruptForShutdown()));
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
