import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { convertClaudeSession } from '../apps/server/src/agents/index.ts';
import { EventLog } from '../apps/server/src/store/index.ts';
import type {
  CodeSpot,
  Gate,
  PipelineStep,
  PlanDocument,
  Project,
  Repo,
  RunPurpose,
  RunRole,
  ShinsaEventInput,
  TaskStage,
} from '../packages/core/src/index.ts';
import {
  type ChatEvent,
  type ChatTool,
  createSettings,
  formatTaskHandle,
  isDecisionGate,
  isReadOnlyRun,
  NO_PROJECT_KEY,
  RUN_AGENT_ROLE,
  SHAPE_PIPELINES,
  serializePlanMarkdown,
} from '../packages/core/src/index.ts';
import { createCodeSample, listCodeTasks } from './seed-code.ts';
import { writeCodeTranscripts } from './seed-code-transcripts.ts';
import { listDelegationTasks, writeDelegationTranscripts } from './seed-delegation.ts';
import {
  CHOSEN_BY_YOU,
  callTool,
  createSeedClock,
  DAY,
  HOUR,
  MINUTE,
  NO_TRIAGE_DECISIONS,
  NOW,
  type Push,
  resolveAgentSession,
  resolveToolOutput,
  type SeedClock,
  type SeedRun,
  type SeedTask,
  say,
  spreadEvents,
  type TimedSeedEvent,
  writeTranscript,
} from './seed-kit.ts';
import { listProcessTasks } from './seed-process.ts';
import { resolveRunOpening, stampRunPrompts } from './seed-prompts.ts';
import { listRoundTasks } from './seed-rounds.ts';
import { listShapeTasks, resolveShapeHandover } from './seed-shapes.ts';
import { listTriggerTasks, writeAccountFiles, writeAccountTranscripts } from './seed-triggers.ts';

const ROOT = Bun.env.SHINSA_SEED_DIR ?? join(homedir(), '.shinsa-seed');
const DATA = join(ROOT, 'data');
const REPOS = join(ROOT, 'repos');
const WORKTREES = join(DATA, 'worktrees');
const DEFAULTS_TEST_EVIDENCE = 'seed-usage-defaults-test.txt';

type Files = Record<string, string>;

function git(args: string[], cwd: string) {
  const result = Bun.spawnSync(['git', ...args], {
    cwd,
    env: { ...Bun.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' },
  });
  if (result.exitCode !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr.toString()}`);
  return result.stdout.toString().trim();
}

function writeFiles(root: string, files: Files) {
  for (const [path, content] of Object.entries(files)) {
    const target = join(root, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
}

function createRepo(name: string, files: Files) {
  const path = join(REPOS, name);
  mkdirSync(path, { recursive: true });
  git(['init', '-q', '-b', 'main'], path);
  git(['config', 'user.email', 'seed@shinsa.dev'], path);
  git(['config', 'user.name', 'Shinsa seed'], path);
  writeFiles(path, files);
  git(['add', '-A'], path);
  git(['commit', '-q', '-m', 'chore: initial commit'], path);
  return path;
}

function createWorktree(repoPath: string, taskId: string, branch: string, base: string, files: Files) {
  const path = join(WORKTREES, taskId);
  git(['worktree', 'add', '-q', '-b', branch, path, base], repoPath);
  writeFiles(path, files);
  return path;
}

function commitWorktree(path: string, message: string) {
  git(['add', '-A'], path);
  git(
    ['-c', 'user.email=seed@shinsa.dev', '-c', 'user.name=Shinsa seed', 'commit', '-q', '-m', message],
    path
  );
}

function lineOf(content: string, needle: string) {
  const index = content.split('\n').findIndex((line) => line.includes(needle));
  if (index < 0) throw new Error(`Seed text not found: ${needle}`);
  return index + 1;
}

function spot(
  file: string,
  content: string,
  from: string,
  to: string,
  attention: CodeSpot['attention'],
  why: string
): CodeSpot {
  return { file, start: lineOf(content, from), end: lineOf(content, to), attention, why };
}

const EMBEDDED_CHAT_BASE = `import { createTransport, type Transport } from './transport';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
}

export interface EmbeddedChatOptions {
  endpoint: string;
  paywallId: string;
  onMessage: (message: ChatMessage) => void;
}

export class EmbeddedChat {
  private transport: Transport;
  private history: ChatMessage[] = [];

  constructor(private options: EmbeddedChatOptions) {
    this.transport = createTransport(options.endpoint);
  }

  async send(text: string) {
    const message: ChatMessage = { id: crypto.randomUUID(), role: 'user', text };
    this.history.push(message);
    const reply = await this.transport.post('/chat', {
      paywallId: this.options.paywallId,
      history: this.history,
    });
    const answer: ChatMessage = { id: crypto.randomUUID(), role: 'assistant', text: reply.text };
    this.history.push(answer);
    this.options.onMessage(answer);
  }

  reset() {
    this.history = [];
  }
}
`;

const EMBEDDED_CHAT_NEW = `import { McpSession, type McpToolResult } from './mcp-session';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  text: string;
  toolName?: string;
}

export interface EmbeddedChatOptions {
  serverUrl: string;
  paywallId: string;
  onMessage: (message: ChatMessage) => void;
  signal?: AbortSignal;
}

export class EmbeddedChat {
  private session: McpSession;
  private history: ChatMessage[] = [];

  constructor(private options: EmbeddedChatOptions) {
    this.session = new McpSession(options.serverUrl, { paywallId: options.paywallId });
  }

  async send(text: string) {
    const message: ChatMessage = { id: crypto.randomUUID(), role: 'user', text };
    this.history.push(message);
    await this.session.ensureConnected(this.options.signal);
    const stream = this.session.complete(this.history, { signal: this.options.signal });
    for await (const part of stream) {
      if (part.kind === 'tool_result') {
        this.record(this.describeTool(part.result));
        continue;
      }
      this.record({ id: part.id, role: 'assistant', text: part.text });
    }
  }

  private record(message: ChatMessage) {
    this.history.push(message);
    this.options.onMessage(message);
  }

  private describeTool(result: McpToolResult): ChatMessage {
    return {
      id: crypto.randomUUID(),
      role: 'tool',
      text: result.isError ? \`\${result.name} failed: \${result.text}\` : result.text,
      toolName: result.name,
    };
  }

  async reset() {
    this.history = [];
    await this.session.close();
  }
}
`;

const MCP_SESSION_NEW = `import { Client } from '@modelcontextprotocol/sdk/client';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp';
import type { ChatMessage } from './embedded-chat';

export interface McpToolResult {
  name: string;
  text: string;
  isError: boolean;
}

export type CompletionPart =
  | { kind: 'text'; id: string; text: string }
  | { kind: 'tool_result'; result: McpToolResult };

const RECONNECT_LIMIT = 3;

export class McpSession {
  private client: Client | null = null;
  private attempts = 0;

  constructor(
    private serverUrl: string,
    private context: { paywallId: string }
  ) {}

  async ensureConnected(signal?: AbortSignal) {
    if (this.client) return;
    if (this.attempts >= RECONNECT_LIMIT) throw new Error('The MCP server is unreachable.');
    this.attempts += 1;
    const transport = new StreamableHTTPClientTransport(new URL(this.serverUrl), {
      requestInit: { headers: { 'x-paywall-id': this.context.paywallId }, signal },
    });
    const client = new Client({ name: 'embedded-chat', version: '2.0.0' });
    await client.connect(transport);
    this.client = client;
    this.attempts = 0;
  }

  async *complete(history: ChatMessage[], options: { signal?: AbortSignal }): AsyncGenerator<CompletionPart> {
    if (!this.client) throw new Error('Call ensureConnected first.');
    const response = await this.client.callTool(
      { name: 'chat.complete', arguments: { history, paywallId: this.context.paywallId } },
      undefined,
      { signal: options.signal }
    );
    for (const item of response.content as { type: string; text?: string; name?: string }[]) {
      if (item.type === 'tool_result') {
        yield { kind: 'tool_result', result: { name: item.name ?? 'tool', text: item.text ?? '', isError: false } };
        continue;
      }
      yield { kind: 'text', id: crypto.randomUUID(), text: item.text ?? '' };
    }
  }

  async close() {
    await this.client?.close();
    this.client = null;
  }
}
`;

const TRANSPORT_BASE = `export interface Transport {
  post(path: string, body: unknown): Promise<{ text: string }>;
}

export function createTransport(endpoint: string): Transport {
  return {
    async post(path, body) {
      const response = await fetch(new URL(path, endpoint), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error(\`Chat request failed with \${response.status}\`);
      return (await response.json()) as { text: string };
    },
  };
}
`;

const DUPLICATE_BASE = `import { db } from '../db';
import type { Paywall } from './types';

export async function duplicatePaywall(paywallId: string, ownerId: string): Promise<Paywall> {
  const source = await db.paywall.findUniqueOrThrow({ where: { id: paywallId } });
  return db.paywall.create({
    data: {
      ...source,
      id: undefined,
      name: \`\${source.name} (copy)\`,
      ownerId,
      createdAt: new Date(),
    },
  });
}
`;

const DUPLICATE_NEW = `import { db } from '../db';
import { PaywallError } from './errors';
import type { Paywall } from './types';

export async function duplicatePaywall(paywallId: string, ownerId: string): Promise<Paywall> {
  const source = await db.paywall.findUniqueOrThrow({ where: { id: paywallId } });
  if (source.kind === 'code_first') {
    throw new PaywallError('code_first_duplicate', 'Code-first paywalls are duplicated from their repository.');
  }
  return db.paywall.create({
    data: {
      ...source,
      id: undefined,
      name: \`\${source.name} (copy)\`,
      ownerId,
      createdAt: new Date(),
    },
  });
}
`;

const ERRORS_BASE = `export type PaywallErrorCode = 'not_found' | 'forbidden';

export class PaywallError extends Error {
  constructor(
    readonly code: PaywallErrorCode,
    message: string
  ) {
    super(message);
  }
}
`;

const ERRORS_NEW = `export type PaywallErrorCode = 'not_found' | 'forbidden' | 'code_first_duplicate';

export class PaywallError extends Error {
  constructor(
    readonly code: PaywallErrorCode,
    message: string
  ) {
    super(message);
  }
}
`;

const DUPLICATE_TEST_NEW = `import { describe, expect, it } from 'bun:test';
import { duplicatePaywall } from './duplicate';
import { seedPaywall } from '../test/seed';

describe('duplicatePaywall', () => {
  it('copies a visual paywall', async () => {
    const paywall = await seedPaywall({ kind: 'visual' });
    const copy = await duplicatePaywall(paywall.id, 'owner-1');
    expect(copy.name).toBe(\`\${paywall.name} (copy)\`);
  });

  it('refuses a code-first paywall', async () => {
    const paywall = await seedPaywall({ kind: 'code_first' });
    await expect(duplicatePaywall(paywall.id, 'owner-1')).rejects.toThrow('duplicated from their repository');
  });
});
`;

const TAB_GROUP_BASE = `import * as React from 'react';

export function TabGroup({ tabs, active, onSelect }: TabGroupProps) {
  return (
    <div className='flex gap-1'>
      {tabs.map((tab) => (
        <button key={tab.id} data-active={tab.id === active} onClick={() => onSelect(tab.id)}>
          {tab.label}
        </button>
      ))}
    </div>
  );
}

interface TabGroupProps {
  tabs: { id: string; label: string }[];
  active: string;
  onSelect: (id: string) => void;
}
`;

const TAB_GROUP_NEW = `import * as React from 'react';

export function TabGroup({ tabs, active, onSelect }: TabGroupProps) {
  const listRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const selected = listRef.current?.querySelector<HTMLElement>('[data-active="true"]');
    selected?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
  }, [active]);

  return (
    <div ref={listRef} className='flex gap-1 overflow-x-auto overscroll-x-contain [scrollbar-width:none]'>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          data-active={tab.id === active}
          className='shrink-0'
          onClick={() => onSelect(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

interface TabGroupProps {
  tabs: { id: string; label: string }[];
  active: string;
  onSelect: (id: string) => void;
}
`;

const DEFAULTS_BASE = `import type { ModelId, Provider } from './models';

export function resolveDefaultModel(provider: Provider): ModelId {
  switch (provider) {
    case 'claude':
      return 'claude-opus-5-5';
    case 'codex':
      return 'gpt-6';
  }
}
`;

const DEFAULTS_NEW = `import type { ModelId, Provider } from './models';
import type { UsageWindow } from './usage';

const FALLBACK_THRESHOLD = 0.85;

export function resolveDefaultModel(provider: Provider, usage: UsageWindow | null): ModelId {
  const preferred = resolvePreferredModel(provider);
  if (!usage || usage.used / usage.limit < FALLBACK_THRESHOLD) return preferred;
  return resolveFallbackModel(provider);
}

function resolvePreferredModel(provider: Provider): ModelId {
  switch (provider) {
    case 'claude':
      return 'claude-opus-5-5';
    case 'codex':
      return 'gpt-6';
  }
}

function resolveFallbackModel(provider: Provider): ModelId {
  switch (provider) {
    case 'claude':
      return 'claude-sonnet-5-5';
    case 'codex':
      return 'gpt-6-mini';
  }
}
`;

const USAGE_NEW = `export interface UsageWindow {
  used: number;
  limit: number;
  resetsAt: number;
}

export function isExhausted(window: UsageWindow, now: number) {
  return window.used >= window.limit && now < window.resetsAt;
}
`;

function resolveSeedPipeline(task: SeedTask): readonly PipelineStep[] | null {
  if (task.composed) return task.composed.pipeline;
  return task.shape ? SHAPE_PIPELINES[task.shape] : null;
}

type Timeline = TimedSeedEvent[];

const SMALL_PLAN = [
  { title: 'Find the cause', detail: 'Reproduce it and trace where it goes wrong.' },
  { title: 'Make the change', detail: 'Fix it in the narrowest place that covers every caller.' },
  { title: 'Verify it', detail: 'Run the checks and confirm the behaviour by hand.' },
];

const LARGE_PLAN = [
  { title: 'Read the current code', detail: 'Map what exists and where the change has to land.' },
  { title: 'Build the core change', detail: 'The new behaviour, behind the existing interfaces.' },
  { title: 'Wire it into the app', detail: 'Connect the screens and commands that use it.' },
  { title: 'Test and capture evidence', detail: 'Tests for the logic, recordings for anything visible.' },
];

const LIVE_STAGES = new Set<TaskStage>([
  'planning',
  'building',
  'reviewing',
  'fixing',
  'investigating',
  'researching',
  'operating',
]);

const SEED_CHECKS = [
  { name: 'bun run lint', outcome: 'pass' as const, detail: null },
  { name: 'bun run check-types', outcome: 'pass' as const, detail: null },
  { name: 'bun test', outcome: 'pass' as const, detail: null },
];

const BUILT_STAGES = new Set<TaskStage>([
  'checking',
  'awaiting_review',
  'shipping',
  'awaiting_merge',
  'merged',
  'awaiting_operation',
]);

function resolveSeedPlan(task: SeedTask): PlanDocument {
  if (task.plan) return task.plan;
  return {
    goal: task.request,
    phases: task.size === 'large' ? LARGE_PLAN : SMALL_PLAN,
    behaviour: [],
    approach: 'Planned by the agent.',
    files: [],
    outOfScope: [],
    verification: ['The tests that cover the change pass, and the change behaves as asked when run by hand.'],
    questions: [],
  };
}

function pushTaskStart(task: SeedTask, push: Push, clock: SeedClock) {
  push(clock.at, {
    type: 'task.created',
    taskId: task.id,
    request: task.request,
    repoId: task.repo.id,
    priority: task.priority ?? 'normal',
    planFirst: task.planFirst ?? false,
    origin: null,
    ...(task.shape && !task.auto?.shape ? { shape: task.shape } : {}),
    auto: task.auto ?? CHOSEN_BY_YOU,
  });
  push(clock.step(0.2), {
    type: 'task.triaged',
    taskId: task.id,
    title: task.title,
    repoId: task.repo.id,
    size: task.size,
    branch: task.branch,
    ...(task.shape ? { pipeline: [...SHAPE_PIPELINES[task.shape]] } : {}),
    decisions: task.decisions ?? NO_TRIAGE_DECISIONS,
  });
  if (task.composed) {
    push(clock.step(0.1), {
      type: 'task.reshaped',
      taskId: task.id,
      pipeline: task.composed.pipeline,
      by: 'agent',
      reason: task.composed.why,
    });
  }
  if (task.waitsOn) {
    push(clock.step(0.05), {
      type: 'task.waits_on_changed',
      taskId: task.id,
      waitsOn: task.waitsOn,
      by: 'you',
    });
  }
  if (task.worktreePath) {
    push(clock.step(0.1), {
      type: 'worktree.created',
      taskId: task.id,
      path: task.worktreePath,
      branch: task.branch,
      workspace: 'worktrees',
    });
  }
}

function resolveRunModel(task: SeedTask, role: RunRole) {
  if (task.provider === 'codex') return 'gpt-6-astra';
  return role === 'reviewer' ? 'claude-sonnet-5-5' : 'claude-opus-5-5';
}

function pushTaskRevision(task: SeedTask, push: Push, clock: SeedClock) {
  if (!task.revision) return;
  const gateId = `${task.id}-review-1`;
  push(clock.step(0.5), {
    type: 'gate.opened',
    gate: {
      id: gateId,
      taskId: task.id,
      type: 'review',
      status: 'open',
      title: `Review “${task.title}”`,
      body: 'Built, checked and reviewed by the agents.',
      runId: null,
      openedAt: clock.at,
      answeredAt: null,
      decision: null,
      response: null,
    },
  });
  push(clock.step(20), {
    type: 'gate.answered',
    gateId,
    decision: 'revise',
    response: task.revision.response,
  });
  push(clock.step(0.1), { type: 'fix.started', taskId: task.id, round: 1, reason: 'you' });
}

interface SeedProgress {
  plan: PlanDocument | null;
  finished: number;
  proposed: boolean;
  built: number;
  fixes: number;
  agentRuns: number;
}

function resolveProposedPlan(task: SeedTask) {
  const planning = task.stage === 'triage' || task.stage === 'waiting_on_tasks' || task.stage === 'planning';
  const inquiring = ['answering', 'researching', 'investigating', 'awaiting_proposal'].includes(task.stage);
  if (planning || inquiring) return null;
  const pipeline = resolveSeedPipeline(task);
  if (pipeline && !pipeline.includes('plan')) return null;
  return resolveSeedPlan(task);
}

function resolveFinishedPhases(task: SeedTask, plan: PlanDocument) {
  if (BUILT_STAGES.has(task.stage)) return plan.phases.length;
  if (task.stage === 'building') return Math.floor(plan.phases.length / 2);
  return 0;
}

function pushPlanProposal(task: SeedTask, progress: SeedProgress, push: Push, clock: SeedClock) {
  if (!progress.plan || progress.proposed) return;
  const { plan } = progress;
  push(clock.step(0.2), { type: 'plan.proposed', taskId: task.id, body: plan.goal, document: plan });
  progress.proposed = true;
}

function pushPhaseDone(task: SeedTask, progress: SeedProgress, push: Push, clock: SeedClock) {
  const index = progress.built;
  const phase = progress.plan?.phases[index];
  push(clock.step(2), {
    type: 'phase.completed',
    taskId: task.id,
    report: {
      index,
      summary: task.report?.sections[index]?.summary ?? phase?.detail ?? 'Done.',
      spots: task.report?.sections[index]?.spots ?? [],
      judgementCalls: index === 0 ? (task.report?.judgementCalls ?? []) : [],
      at: 0,
    },
  });
  push(clock.step(0), { type: 'phase.updated', taskId: task.id, index, status: 'done' });
  progress.built += 1;
}

function resolveRunPhase(progress: SeedProgress, run: SeedRun) {
  if (run.purpose !== 'build') return {};
  const last = (progress.plan?.phases.length ?? 1) - 1;
  return { phaseIndex: Math.min(progress.built, last) };
}

function pushFixStart(task: SeedTask, index: number, progress: SeedProgress, push: Push, clock: SeedClock) {
  const run = task.runs?.[index];
  if (run?.purpose !== 'fix') return;
  progress.fixes += 1;
  if (index - 1 === task.revision?.afterRun) return;
  push(clock.step(0.1), {
    type: 'fix.started',
    taskId: task.id,
    round: progress.fixes,
    reason: run.fix ?? 'checks',
  });
}

function pushTaskRun(task: SeedTask, index: number, progress: SeedProgress, push: Push, clock: SeedClock) {
  const run = task.runs?.[index];
  if (!run) return;
  const runId = `${task.id}-run-${index}`;
  const agent = run.role === 'agent';
  pushFixStart(task, index, progress, push, clock);
  push(clock.step(0.5), {
    type: 'run.started',
    run: {
      id: runId,
      taskId: task.id,
      role: run.role,
      ...(run.purpose ? { purpose: run.purpose } : {}),
      ...resolveRunPhase(progress, run),
      provider: task.provider ?? 'claude',
      model: resolveRunModel(task, run.role),
      sessionId: agent ? resolveAgentSession(task.id) : `session-${runId}`,
      sessionProvider: task.provider ?? 'claude',
      ...(agent && progress.agentRuns > 0 ? { resume: true } : {}),
      startedAt: clock.at,
      endedAt: null,
      outcome: null,
      summary: null,
      status: 'running',
    },
  });
  if (agent) progress.agentRuns += 1;
}

function pushTaskRuns(task: SeedTask, push: Push, clock: SeedClock) {
  const runs = task.runs ?? [];
  const plan = resolveProposedPlan(task);
  const progress: SeedProgress = {
    plan,
    finished: plan ? resolveFinishedPhases(task, plan) : 0,
    proposed: false,
    built: 0,
    fixes: 0,
    agentRuns: 0,
  };
  if (!runs.some((run) => run.purpose === 'plan')) pushPlanProposal(task, progress, push, clock);
  for (const [index, run] of runs.entries()) {
    const live = index === runs.length - 1 && !run.failed && LIVE_STAGES.has(task.stage);
    if (live && run.purpose === 'build') {
      while (progress.built < progress.finished) pushPhaseDone(task, progress, push, clock);
    }
    pushTaskRun(task, index, progress, push, clock);
    if (live) continue;
    push(clock.step(run.minutes), {
      type: 'run.ended',
      runId: `${task.id}-run-${index}`,
      outcome: run.failed ? 'failed' : 'completed',
      summary: run.summary,
    });
    if (run.purpose === 'plan' && !run.failed) pushPlanProposal(task, progress, push, clock);
    if (run.purpose === 'build' && !run.failed && progress.built < progress.finished) {
      pushPhaseDone(task, progress, push, clock);
    }
    if (index === task.revision?.afterRun) pushTaskRevision(task, push, clock);
  }
  pushTaskPlan(task, progress, push, clock);
}

function pushTaskPlan(task: SeedTask, progress: SeedProgress, push: Push, clock: SeedClock) {
  pushPlanProposal(task, progress, push, clock);
  while (progress.built < progress.finished) pushPhaseDone(task, progress, push, clock);
  const phases = progress.plan?.phases.length ?? 0;
  if (task.stage === 'building' && progress.finished < phases) {
    push(clock.step(1), {
      type: 'phase.updated',
      taskId: task.id,
      index: progress.finished,
      status: 'active',
    });
  }
}

function pushTaskPullRequest(task: SeedTask, push: Push, clock: SeedClock) {
  if (!task.pullRequest) return;
  const repository = task.repo.remote?.split(':').at(-1)?.replace('.git', '');
  push(clock.step(1), {
    type: 'pull_request.opened',
    taskId: task.id,
    pullRequest: {
      number: task.pullRequest.number,
      url: `https://github.com/${repository}/pull/${task.pullRequest.number}`,
      state: task.merged ? 'merged' : 'open',
      checks: task.pullRequest.checks,
      unresolvedComments: task.pullRequest.comments ?? 0,
      mergeable: task.pullRequest.checks === 'passing',
      updatedAt: clock.at,
      ...(task.pullRequest.mergeCommit ? { mergeCommit: task.pullRequest.mergeCommit } : {}),
    },
  });
}

function pushTaskResults(task: SeedTask, push: Push, clock: SeedClock) {
  if (BUILT_STAGES.has(task.stage) && task.stage !== 'checking') {
    push(clock.step(0.3), { type: 'checks.recorded', taskId: task.id, results: SEED_CHECKS });
  }
  const builds = resolveSeedPipeline(task)?.includes('build') ?? true;
  if (builds && (task.report || task.summary)) {
    push(clock.step(0.2), {
      type: 'work.submitted',
      taskId: task.id,
      summary: task.summary ?? task.report?.headline ?? '',
      report: task.report ?? null,
    });
  }
  if (task.findings)
    push(clock.step(0.2), { type: 'review.reported', taskId: task.id, findings: task.findings });
  pushTaskPullRequest(task, push, clock);
}

function resolveSeedGateRun(task: SeedTask) {
  const runs = task.runs?.length ?? 0;
  if (!task.gate || isDecisionGate(task.gate) || runs === 0) return null;
  return `${task.id}-run-${runs - 1}`;
}

function pushTaskGate(task: SeedTask, push: Push, clock: SeedClock) {
  if (!task.gate) return;
  const gate: Gate = {
    id: `${task.id}-gate`,
    taskId: task.id,
    type: task.gate.type,
    status: 'open',
    title: task.gate.title,
    body: task.gate.body,
    runId: resolveSeedGateRun(task),
    openedAt: clock.at,
    answeredAt: null,
    decision: null,
    response: null,
    ...task.gate.details,
  };
  push(clock.at, { type: 'gate.opened', gate });
}

function pushTask(task: SeedTask, push: Push) {
  const clock = createSeedClock(NOW - task.ageHours * HOUR);
  pushTaskStart(task, push, clock);
  if (task.script) {
    task.script(push, clock);
    return;
  }
  pushTaskRuns(task, push, clock);
  pushTaskResults(task, push, clock);
  if (task.note) push(clock.step(0.1), { type: 'task.noted', taskId: task.id, note: task.note });
  for (const event of task.extra ?? []) push(clock.step(0.1), event);
  for (const { at, event } of task.timed ?? []) push(at, event);
  push(clock.step(0.1), { type: 'task.staged', taskId: task.id, stage: task.stage, reason: task.reason });
  pushTaskGate(task, push, clock);
}

function buildEvents(tasks: SeedTask[], projects: Project[], repos: Repo[]) {
  const timeline: Timeline = [];
  const push = (at: number, event: ShinsaEventInput) => timeline.push({ at, event });
  const start = NOW - 10 * DAY;
  for (const project of projects) push(start, { type: 'project.written', project });
  for (const repo of repos) push(start, { type: 'repo.registered', repo });

  push(start, { type: 'settings.changed', settings: { ...createSettings(), taskUsageLimit: 10 } });
  for (const task of tasks) pushTask(task, push);
  push(NOW - 3 * MINUTE, {
    type: 'briefing.written',
    projectId: null,
    text: 'Start with “Run the embedded chat on MCP v2”: it is ready for review, and the tool calls work waits on it. Then “Refuse to duplicate code-first paywalls” and “Rewrite the framework command registry”.',
    briefing: {
      now: {
        taskId: 'task-embedded-chat',
        why: 'Built and checked, and “Let the embedded chat call paywall tools” waits on it, so reviewing it first frees that work',
      },
      next: [
        { taskId: 'task-duplicate', why: 'Pull request #4531 is clean and ready to merge' },
        { taskId: 'task-command-registry', why: 'The plan needs your approval before building starts' },
      ],
      running: 'Agents are working on the remaining tasks.',
      note: null,
    },
  });
  return stampTaskHandles(
    timeline.sort((a, b) => a.at - b.at),
    projects,
    repos
  );
}

function stampTaskHandles(timeline: Timeline, projects: Project[], repos: Repo[]): Timeline {
  const counts = new Map<string, number>();
  const stamped = new Set<string>();
  const resolveHandle = (repoId: string | null) => {
    const projectId = repos.find((repo) => repo.id === repoId)?.projectId ?? null;
    const key = projects.find((project) => project.id === projectId)?.key;
    const counted = projectId && key ? key : NO_PROJECT_KEY;
    const number = (counts.get(counted) ?? 0) + 1;
    counts.set(counted, number);
    return { projectId: projectId && key ? projectId : null, handle: formatTaskHandle(counted, number) };
  };
  return timeline.map(({ at, event }) => {
    if (event.type === 'task.created') {
      const projectId = repos.find((repo) => repo.id === event.repoId)?.projectId ?? null;
      if (!projectId || !projects.some((project) => project.id === projectId)) return { at, event };
      stamped.add(event.taskId);
      return { at, event: { ...event, ...resolveHandle(event.repoId) } };
    }
    if (event.type !== 'task.triaged' || stamped.has(event.taskId)) return { at, event };
    stamped.add(event.taskId);
    return { at, event: { ...event, ...resolveHandle(event.repoId) } };
  });
}

interface SeedRunTimes {
  task: SeedTask;
  role: RunRole;
  purpose: RunPurpose | null;
  opening: string | null;
  index: number;
  startedAt: number;
  endedAt: number | null;
  failed: boolean;
}

const SEED_FILES: Record<string, { read: string; edit: string; test: string }> = {
  'repo-paywall': {
    read: 'src/export/clickhouse.ts',
    edit: 'src/export/clickhouse.ts',
    test: 'bun test src/export',
  },
  'repo-kanna': {
    read: 'src/client/app/ChatPage/index.tsx',
    edit: 'src/server/ws-router.ts',
    test: 'bun test',
  },
};

function seedFiles(task: SeedTask) {
  return SEED_FILES[task.repo.id] ?? { read: 'src/index.ts', edit: 'src/index.ts', test: 'bun test' };
}

function resolveHandover({ task, role, purpose }: SeedRunTimes): ChatTool {
  const body = task.summary ?? task.title;
  if (purpose === 'plan') {
    return { kind: 'shinsa', name: 'propose_plan', args: { goal: task.request, phases: SMALL_PLAN } };
  }
  if (purpose === 'build') return { kind: 'shinsa', name: 'complete_phase', args: { summary: body } };
  if (purpose === 'operate') return { kind: 'shinsa', name: 'report_outcome', args: { outcome: body } };
  if (role === 'reviewer') {
    return { kind: 'shinsa', name: 'report_review', args: { findings: task.findings ?? [] } };
  }
  return (
    resolveShapeHandover(role, body) ?? { kind: 'shinsa', name: 'complete_fix', args: { summary: body } }
  );
}

function buildRunEvents(times: SeedRunTimes, live: boolean): ChatEvent[] {
  const { task, role } = times;
  const files = seedFiles(task);
  const brief: ChatEvent = {
    type: 'user',
    from: 'shinsa',
    text:
      times.opening ??
      `You are the ${role} for "${task.title}".\n\nThe request: ${task.request}\n\nWork in the task's worktree and hand over through the Shinsa tools.`,
    attachments: [],
  };
  const edits: ChatEvent[] = isReadOnlyRun({ role, purpose: times.purpose ?? undefined })
    ? [
        say(
          'The chunk loop has no retry, so one slow chunk fails the whole export. The tests show where it breaks.'
        ),
      ]
    : [
        say(
          'The chunk loop has no retry, so one slow chunk fails the whole export. I will wrap the write and keep the offset.'
        ),
        callTool('edit-1', {
          kind: 'edit',
          path: files.edit,
          hunks: [
            {
              before: '  for (const chunk of chunks) await writeChunk(chunk);',
              after: '  for (const chunk of chunks) await retry(() => writeChunk(chunk), { attempts: 3 });',
            },
          ],
        }),
        resolveToolOutput('edit-1', 'The file has been updated.'),
      ];
  const work: ChatEvent[] = [
    { type: 'status', status: 'started', outcome: null },
    brief,
    say(`I'll start by reading how ${files.read.split('/').at(-1)} handles this today.`),
    callTool('read-1', { kind: 'read', path: files.read, range: { start: 1, end: 40 } }),
    resolveToolOutput(
      'read-1',
      '1\texport async function runExport(app: App) {\n2\t  const chunks = planChunks(app);\n3\t  for (const chunk of chunks) await writeChunk(chunk);\n4\t}'
    ),
    callTool('grep-1', { kind: 'search', mode: 'content', query: 'writeChunk', path: 'src' }),
    resolveToolOutput('grep-1', 'src/export/clickhouse.ts:3\nsrc/export/chunks.ts:18'),
    ...edits,
    say('Running the tests for the export now.'),
    callTool('test-1', {
      kind: 'command',
      action: 'run',
      command: files.test,
      description: 'Run the export tests',
    }),
  ];
  if (task.gate?.type === 'question' && live) {
    return [
      ...work,
      resolveToolOutput('test-1', ' 12 pass\n 0 fail'),
      say('The tests pass. One decision is yours before I go further.'),
      callTool('ask-1', {
        kind: 'shinsa',
        name: 'ask',
        args: { question: task.gate.title, context: task.gate.body },
      }),
      { type: 'status', status: 'waiting', outcome: null },
    ];
  }
  if (live) return work;
  const handover = resolveHandover(times);
  const seeded = task.runs?.[times.index];
  const summary = seeded?.summary ?? 'Done.';
  const ending: ChatEvent[] = times.failed
    ? [resolveToolOutput('test-1', ' 11 pass\n 1 fail'), { type: 'error', text: summary }]
    : [
        resolveToolOutput('test-1', ' 12 pass\n 0 fail'),
        callTool('handover-1', handover),
        resolveToolOutput('handover-1', 'Handed over.'),
        { type: 'agent', phase: 'final', text: seeded?.reply ?? summary },
      ];
  return [
    ...work,
    ...ending,
    { type: 'status', status: 'ended', outcome: times.failed ? 'failed' : 'completed' },
  ];
}

function isRunRole(role: string): role is RunRole {
  return role in RUN_AGENT_ROLE;
}

function listRunTimes(tasks: SeedTask[], timeline: { at: number; event: ShinsaEventInput }[]) {
  const byTask = new Map(tasks.map((task) => [task.id, task]));
  const times = new Map<string, SeedRunTimes>();
  for (const { at, event } of timeline) {
    if (event.type === 'run.started') {
      const task = byTask.get(event.run.taskId);
      const index = Number(event.run.id.split('-run-').at(-1));
      const { role } = event.run;
      if (task && isRunRole(role))
        times.set(event.run.id, {
          task,
          role,
          purpose: event.run.purpose ?? null,
          opening: resolveRunOpening(event.run),
          index,
          startedAt: at,
          endedAt: null,
          failed: false,
        });
    }
    if (event.type === 'run.ended') {
      const run = times.get(event.runId);
      if (run) Object.assign(run, { endedAt: at, failed: event.outcome === 'failed' });
    }
  }
  return [...times.entries()];
}

const PLAN_TIER_PLAN: PlanDocument = {
  goal: 'Every list knows its owner’s plan tier, so the server can enforce the shared-list limit without asking Stripe on each request.',
  phases: [
    { title: 'Add the column', detail: 'A nullable `plan_tier` on `lists`, with a migration.' },
    {
      title: 'Write it on change',
      detail: 'The Stripe webhook updates the tier of every list its owner has.',
    },
    { title: 'Enforce the limit', detail: 'Free owners get 3 shared lists; the API answers 402 past it.' },
  ],
  behaviour: [
    'A new list gets its owner’s tier.',
    'Upgrading in Stripe updates every list within a minute.',
    'A free owner’s fourth shared list is refused with a clear message.',
  ],
  approach:
    'The column stays nullable until the backfill has run, so the deploy never blocks on it. The limit check reads the column only.',
  files: [
    { path: 'src/db/schema.ts', change: 'The `plan_tier` column.' },
    { path: 'src/billing/webhook.ts', change: 'Writes the tier on subscription changes.' },
  ],
  outOfScope: ['Changing the prices or the tiers themselves.'],
  verification: ['A test per tier for the shared-list limit.'],
  questions: [],
  impact:
    'Writes `plan_tier` on the 18,402 lists that have none, from their owner’s subscription. The dry run lists every list and the tier it would get. Undo by setting `plan_tier` back to null; the limit check treats null as the free tier.',
  operation: [
    'Run `bun scripts/backfill-plan-tier.ts --dry-run` against production and check it reports 18,402 lists to update.',
    'Run it without `--dry-run` in batches of 1,000 and check `select count(*) from lists where plan_tier is null` is 0.',
  ],
};

function listBasketTasks({ basketServer, basketSdk }: { basketServer: Repo; basketSdk: Repo }): SeedTask[] {
  return [
    {
      id: 'task-basket-plan-tier',
      request:
        'Store each list owner’s plan tier on the list and enforce the shared-list limit, then backfill the tier for existing lists once it ships.',
      title: 'Plan tier on lists, then backfill it',
      repo: basketServer,
      size: 'small',
      shape: 'change',
      composed: {
        pipeline: [...SHAPE_PIPELINES.change, 'operate'],
        why: 'The column has to ship before the existing lists can be backfilled.',
      },
      stage: 'awaiting_plan',
      reason: 'plan ready for you',
      branch: 'feat/plan-tier-on-lists',
      ageHours: 0.8,
      plan: PLAN_TIER_PLAN,
      runs: [{ role: 'agent', purpose: 'plan', minutes: 4, summary: 'Proposed the plan.' }],
      gate: {
        type: 'plan',
        title: 'Plan tier on lists, then backfill it',
        body: serializePlanMarkdown(PLAN_TIER_PLAN),
      },
    },
    {
      id: 'task-basket-sync',
      request: 'How does the SDK decide when to sync a list with the server?',
      title: 'When the SDK syncs a list',
      repo: basketSdk,
      size: 'small',
      shape: 'answer',
      stage: 'done',
      reason: 'answered your question',
      branch: 'ask/sdk-sync',
      ageHours: 3,
      runs: [{ role: 'answerer', minutes: 2, summary: 'Answered the question.' }],
      extra: [
        {
          type: 'task.delivered',
          taskId: 'task-basket-sync',
          step: 'answer',
          body: '`ListSync` pushes after every local edit, debounced by 2 seconds, and pulls when the app comes to the foreground.',
          runId: 'task-basket-sync-run-0',
        },
      ],
    },
  ];
}

function writeEvidenceFiles() {
  const evidence = join(DATA, 'evidence');
  mkdirSync(evidence, { recursive: true });
  writeFileSync(
    join(evidence, DEFAULTS_TEST_EVIDENCE),
    'bun test v1.3.0\n\nsrc/shared/defaults.test.ts:\n✓ keeps the preferred model below 85%\n✓ falls back at 85% of the window\n✓ keeps the preferred model without usage data\n\n 3 pass\n 0 fail\n'
  );
}

function writeSessionTranscript(session: string, runTimes: [string, SeedRunTimes][], transcripts: string) {
  const evidence = join(DATA, 'evidence');
  let images = 0;
  const entries = convertClaudeSession(readFileSync(session, 'utf8'), (data, mediaType) => {
    images += 1;
    const file = `seed-image-${images}.${mediaType.split('/')[1] ?? 'png'}`;
    writeFileSync(join(evidence, file), Buffer.from(data, 'base64'));
    return `/api/evidence/${file}`;
  });
  const window = runTimes.find(([runId]) => runId === 'task-embedded-chat-run-1')?.[1];
  const first = entries[0]?.at ?? 0;
  const span = Math.max(1, (entries.at(-1)?.at ?? first) - first);
  const fitted = window
    ? entries.map((entry) => ({
        ...entry,
        at:
          window.startedAt +
          Math.round(((entry.at - first) / span) * ((window.endedAt ?? NOW) - window.startedAt)),
      }))
    : entries;
  writeFileSync(
    join(transcripts, 'task-embedded-chat-run-1.jsonl'),
    `${fitted.map((entry) => JSON.stringify(entry)).join('\n')}\n`
  );
  console.info(`Seeded a crowded chat with ${entries.length} entries from ${session}`);
}

function createProjects(): Project[] {
  return [
    {
      id: 'project-superwall',
      name: 'Superwall',
      color: 'blue',
      key: 'SW',
      description:
        'Superwall’s paywall editor and its docs. paywall-next is the editor and the embedded chat; docs is the public documentation site.',
      folders: [join(REPOS, 'superwall')],
    },
    {
      id: 'project-basket',
      name: 'Basket',
      color: 'green',
      key: 'BSK',
      description:
        'A grocery list app: the Swift SDK the app and partners use, the Bun API server with its Postgres schema, and the iOS app.',
      folders: [join(REPOS, 'basket')],
    },
    {
      id: 'project-personal',
      name: 'Personal',
      color: 'purple',
      key: 'PER',
      description: 'Side projects: Kanna, the coding agent UI, and prints, the print queue.',
      folders: [],
    },
  ];
}

function createSeedRepo(id: string, name: string, path: string, remote: string, projectId: string): Repo {
  return {
    id,
    name,
    path,
    defaultBranch: 'main',
    remote,
    projectId,
    checkCommands: ['bun lint', 'bun check-types', 'bun test'],
  };
}

interface SeedRepos {
  paywall: Repo;
  kanna: Repo;
  docs: Repo;
  prints: Repo;
  basketSdk: Repo;
  basketServer: Repo;
  basketApp: Repo;
}

function createRepos(): SeedRepos {
  const paywallBase: Files = {
    'src/chat/embedded-chat.ts': EMBEDDED_CHAT_BASE,
    'src/chat/transport.ts': TRANSPORT_BASE,
    'src/paywalls/duplicate.ts': DUPLICATE_BASE,
    'src/paywalls/errors.ts': ERRORS_BASE,
    'src/ui/tab-group.tsx': TAB_GROUP_BASE,
    'package.json': '{ "name": "paywall-next", "private": true }\n',
  };
  const paywallPath = createRepo('superwall/paywall-next', paywallBase);
  const kannaPath = createRepo('kanna', {
    'src/shared/defaults.ts': DEFAULTS_BASE,
    'package.json': '{ "name": "kanna-code" }\n',
  });
  const docsPath = createRepo('superwall/docs', {
    'framework/access.mdx': '# Access\n\nRequest access from support.\n',
  });
  const printsPath = createRepo('prints', { 'src/queue.ts': 'export const queue: string[] = [];\n' });
  const basketSdkPath = createRepo('basket/basket-ios-sdk', {
    'Sources/Basket/ListSync.swift': 'public struct ListSync {}\n',
    'Package.swift': '// swift-tools-version:5.10\n',
  });
  const basketServerPath = createRepo('basket/basket-server', {
    'src/db/schema.ts': 'export const lists = { id: "uuid", ownerId: "uuid", name: "text" };\n',
    'package.json': '{ "name": "basket-server", "private": true }\n',
  });
  const basketAppPath = createRepo('basket/basket-app', {
    'Basket/ListView.swift': 'struct ListView {}\n',
  });

  const paywall = createSeedRepo(
    'repo-paywall',
    'paywall-next',
    paywallPath,
    'git@github.com:superwall/paywall-next.git',
    'project-superwall'
  );
  const kanna = createSeedRepo(
    'repo-kanna',
    'kanna',
    kannaPath,
    'git@github.com:chroxify/kanna.git',
    'project-personal'
  );
  const docs = createSeedRepo(
    'repo-docs',
    'docs',
    docsPath,
    'git@github.com:superwall/docs.git',
    'project-superwall'
  );
  const prints = createSeedRepo(
    'repo-prints',
    'prints',
    printsPath,
    'git@github.com:chroxify/prints.git',
    'project-personal'
  );

  const basketSdk = createSeedRepo(
    'repo-basket-sdk',
    'basket-ios-sdk',
    basketSdkPath,
    'git@github.com:basket/basket-ios-sdk.git',
    'project-basket'
  );
  const basketServer = createSeedRepo(
    'repo-basket-server',
    'basket-server',
    basketServerPath,
    'git@github.com:basket/basket-server.git',
    'project-basket'
  );
  const basketApp = createSeedRepo(
    'repo-basket-app',
    'basket-app',
    basketAppPath,
    'git@github.com:basket/basket-app.git',
    'project-basket'
  );
  return { paywall, kanna, docs, prints, basketSdk, basketServer, basketApp };
}

interface SeedWorktrees {
  chat: string;
  duplicate: string;
  tabs: string;
  rounds: string;
  defaults: string;
}

function createWorktrees({ paywall, kanna }: SeedRepos): SeedWorktrees {
  const paywallPath = paywall.path;
  const kannaPath = kanna.path;
  const chatPath = createWorktree(paywallPath, 'task-embedded-chat', 'feat/embedded-chat-mcp', 'main', {
    'src/chat/embedded-chat.ts': EMBEDDED_CHAT_NEW,
    'src/chat/mcp-session.ts': MCP_SESSION_NEW,
  });
  rmSync(join(chatPath, 'src/chat/transport.ts'));
  commitWorktree(chatPath, 'feat(chat): run the embedded chat on MCP v2');
  const duplicatePath = createWorktree(paywallPath, 'task-duplicate', 'fix/code-first-duplicate', 'main', {
    'src/paywalls/duplicate.ts': DUPLICATE_NEW,
    'src/paywalls/errors.ts': ERRORS_NEW,
    'src/paywalls/duplicate.test.ts': DUPLICATE_TEST_NEW,
  });
  commitWorktree(duplicatePath, 'fix(paywalls): refuse to duplicate code-first paywalls');
  const tabsPath = createWorktree(paywallPath, 'task-tab-scroll', 'fix/tab-group-scroll', 'main', {
    'src/ui/tab-group.tsx': TAB_GROUP_NEW,
  });
  git(['branch', 'feat/mcp-v2-agent-4', 'main'], paywallPath);
  const roundsPath = createWorktree(
    paywallPath,
    'task-mcp-rounds',
    'feat/mcp-v2-agent-5',
    'feat/mcp-v2-agent-4',
    {
      'src/agent/tool-cache.ts': 'export const TOOL_CACHE_TTL_MS = 60 * 60 * 1000;\n',
    }
  );
  const defaultsPath = createWorktree(kannaPath, 'task-usage-defaults', 'feat/usage-aware-defaults', 'main', {
    'src/shared/defaults.ts': DEFAULTS_NEW,
    'src/shared/usage.ts': USAGE_NEW,
  });
  return {
    chat: chatPath,
    duplicate: duplicatePath,
    tabs: tabsPath,
    rounds: roundsPath,
    defaults: defaultsPath,
  };
}

function listEmbeddedChatTasks({ paywall }: SeedRepos, worktrees: SeedWorktrees): SeedTask[] {
  const chatPath = worktrees.chat;
  const chatFile = 'src/chat/embedded-chat.ts';
  const sessionFile = 'src/chat/mcp-session.ts';
  return [
    {
      id: 'task-embedded-chat',
      request:
        'Rework the embedded chat so it talks to MCP v2 instead of the old /chat endpoint. Tool results should show up in the conversation.',
      title: 'Run the embedded chat on MCP v2',
      repo: paywall,
      size: 'large',
      planFirst: true,
      priority: 'high',
      stage: 'awaiting_review',
      reason: 'built, checked and ready for review',
      branch: 'feat/embedded-chat-mcp',
      ageHours: 28,
      worktreePath: chatPath,
      plan: {
        goal: 'The embedded chat sends every message through an MCP v2 session and shows tool results inline, so the chat can act on the paywall it is embedded in.',
        phases: [
          {
            title: 'Open an MCP v2 session',
            detail: 'One session per embedded chat, reconnecting with backoff.',
          },
          {
            title: 'Route messages through it',
            detail: 'Every send goes over the session instead of the old endpoint.',
          },
          {
            title: 'Render tool results inline',
            detail: 'Tool calls and their results show in the transcript.',
          },
          {
            title: 'Test reconnects',
            detail: 'Drop the connection mid-reply and confirm the draft survives.',
          },
        ],
        behaviour: [
          'Messages stream from the MCP server instead of arriving as one reply.',
          'Tool results appear as their own rows, with failures labelled.',
          'Closing the chat closes the MCP session.',
        ],
        approach:
          'Replace the fetch transport with an McpSession wrapper around the official SDK client. The chat keeps its public API; only the constructor option changes from endpoint to serverUrl.',
        files: [
          { path: chatFile, change: 'Use McpSession, record tool results, close on reset.' },
          { path: sessionFile, change: 'New: connection, reconnect limit, completion stream.' },
          { path: 'src/chat/transport.ts', change: 'Deleted; nothing else imports it.' },
        ],
        outOfScope: ['Calling paywall tools from the chat (a task that waits on this one).'],
        verification: [
          'Unit tests for the session reconnect limit.',
          'Recording of a chat with one tool call.',
        ],
        questions: [],
      },
      report: {
        headline: 'The embedded chat now runs on an MCP v2 session and renders tool results inline.',
        sections: [
          {
            title: 'Open an MCP session per chat',
            summary:
              'A new McpSession owns the SDK client, connects lazily and gives up after three failed attempts.',
            spots: [
              spot(
                sessionFile,
                MCP_SESSION_NEW,
                'async ensureConnected',
                'this.attempts = 0;',
                'critical',
                'The reconnect counter only resets on success. A server that drops after connecting gets three new tries each time, not three in total.'
              ),
              spot(
                sessionFile,
                MCP_SESSION_NEW,
                'const transport = new StreamableHTTPClientTransport',
                "requestInit: { headers: { 'x-paywall-id'",
                'high',
                'The paywall id travels as a header; the MCP server must accept it on every request, not just initialize.'
              ),
            ],
          },
          {
            title: 'Stream the reply into the chat',
            summary:
              'send() iterates the completion stream and records text and tool results as separate messages.',
            spots: [
              spot(
                chatFile,
                EMBEDDED_CHAT_NEW,
                'const stream = this.session.complete',
                "this.record({ id: part.id, role: 'assistant'",
                'high',
                'Each streamed part becomes its own message. Long replies will arrive as many rows unless the server sends one text part.'
              ),
              spot(
                chatFile,
                EMBEDDED_CHAT_NEW,
                'private describeTool',
                'toolName: result.name,',
                'normal',
                'Failed tools are shown to the user with the raw error text.'
              ),
            ],
          },
          {
            title: 'Close the session on reset',
            summary: 'reset() is now async and closes the MCP connection; callers were updated.',
            spots: [
              spot(
                chatFile,
                EMBEDDED_CHAT_NEW,
                'async reset()',
                'await this.session.close();',
                'normal',
                'reset() changed from sync to async. Two call sites in the editor await it now.'
              ),
            ],
          },
        ],
        checks: [
          { name: 'bun lint', outcome: 'pass', detail: null },
          { name: 'bun check-types', outcome: 'pass', detail: null },
          { name: 'bun test', outcome: 'pass', detail: '48 tests, 3 new' },
        ],
        judgementCalls: [
          {
            call: 'Kept the public EmbeddedChat API',
            reason: 'Only the constructor option was renamed, so the editor change stays small.',
            file: chatFile,
            line: 10,
          },
          {
            call: 'Reconnect limit of 3',
            reason:
              'Matches the editor’s other network retries; past that the user sees an error instead of a spinner.',
            file: sessionFile,
            line: 15,
          },
        ],
      },
      findings: [
        {
          severity: 'suggestion',
          file: sessionFile,
          line: lineOf(MCP_SESSION_NEW, 'this.attempts = 0;'),
          message:
            'Reset the attempt counter when a connected client drops, or the limit applies per connection rather than per session.',
        },
      ],
      runs: [
        { role: 'agent', purpose: 'plan', minutes: 6, summary: 'Proposed the MCP session plan.' },
        { role: 'agent', purpose: 'build', minutes: 34, summary: 'Built the session and rewired the chat.' },
        {
          role: 'reviewer',
          minutes: 4,
          summary: 'One suggestion on the reconnect counter.',
          reply:
            'One suggestion, nothing blocking. The reconnect counter in [mcp-session.ts](shinsa://file/src/chat/mcp-session.ts#L15) only resets after a successful connect, so a flaky server gets three new tries every time.\n\n[Let the embedded chat call paywall tools](shinsa://task/task-chat-tools) waits on this change, and #4531 from "Refuse to duplicate code-first paywalls" touches the same editor, so merging that first keeps the conflicts small. The work is on [feat/embedded-chat-mcp](shinsa://branch/feat/embedded-chat-mcp) in [paywall-next](shinsa://repo/paywall-next).',
        },
      ],
      gate: {
        type: 'review',
        title: 'Review the embedded chat on MCP v2',
        body: 'Built, checked and reviewed by an agent. One suggestion left for you to judge.',
      },
    },
    {
      id: 'task-chat-tools',
      request: 'Let the embedded chat call paywall.read and paywall.update through MCP.',
      title: 'Let the embedded chat call paywall tools',
      repo: paywall,
      size: 'large',
      stage: 'waiting_on_tasks',
      reason: 'waiting for “Run the embedded chat on MCP v2” to finish',
      branch: 'feat/embedded-chat-tools',
      ageHours: 20,
      waitsOn: ['task-embedded-chat'],
    },
    {
      id: 'task-chat-paywall-editing',
      request:
        'Edit a paywall from inside the embedded chat: the chat proposes the change and shows it live.',
      title: 'Edit paywalls from the embedded chat',
      repo: paywall,
      size: 'large',
      stage: 'waiting_on_tasks',
      reason: 'waiting for “Let the embedded chat call paywall tools” to finish',
      branch: 'feat/embedded-chat-paywall-editing',
      ageHours: 18,
      waitsOn: ['task-chat-tools'],
    },
    {
      id: 'task-tool-progress',
      request: 'Show a progress line in the chat while a streamed MCP tool is still running.',
      title: 'Show tool progress in the chat',
      repo: paywall,
      size: 'small',
      stage: 'waiting_on_tasks',
      reason: 'waiting for “Stream MCP tool results” to finish',
      branch: 'feat/chat-tool-progress',
      ageHours: 0.9,
      waitsOn: ['task-stream-tools'],
    },
    {
      id: 'task-tool-retry',
      request: 'Retry a streamed MCP tool call from the chat when it fails halfway.',
      title: 'Retry failed tool calls in the chat',
      repo: paywall,
      size: 'small',
      priority: 'high',
      stage: 'waiting_on_tasks',
      reason: 'waiting for “Stream MCP tool results” to finish',
      branch: 'feat/chat-tool-retry',
      ageHours: 0.85,
      waitsOn: ['task-stream-tools'],
      extra: [
        {
          type: 'on_behalf.acted',
          command: 'task.prioritize',
          taskId: 'task-tool-retry',
          summary: 'Set the priority of “Retry failed tool calls in the chat” to high',
          byTaskId: 'task-stream-tools',
        },
      ],
    },
    {
      id: 'task-tool-summary',
      request: 'At the end of a chat, summarise which tools ran, how long they took and which were retried.',
      title: 'Summarise tool runs at the end of a chat',
      repo: paywall,
      size: 'large',
      stage: 'waiting_on_tasks',
      reason: 'waiting for “Show tool progress in the chat”, “Retry failed tool calls in the chat” to finish',
      branch: 'feat/chat-tool-summary',
      ageHours: 0.8,
      waitsOn: ['task-tool-progress', 'task-tool-retry'],
    },
  ];
}

function listBacklogTasks({ paywall, docs }: SeedRepos): SeedTask[] {
  return [
    {
      id: 'task-webhook-docs',
      request: 'Document signed webhooks and the export retry rules in the integration guide.',
      title: 'Document signed webhooks and export retries',
      repo: docs,
      size: 'small',
      priority: 'low',
      stage: 'waiting_on_tasks',
      reason: 'waiting for “Sign outgoing webhooks”, “Retry ClickHouse exports that time out” to finish',
      branch: 'docs/webhooks-and-export-retries',
      ageHours: 0.35,
      waitsOn: ['task-webhook-signing', 'task-export-retry'],
    },
    {
      id: 'task-retire-old-editor',
      request: 'Retire the old editor route once the banner has pointed people to the new one.',
      title: 'Retire the old editor route',
      repo: paywall,
      size: 'small',
      stage: 'waiting_on_tasks',
      reason:
        'waiting for “Banner for the old editor”, “Move through the paywall gallery with arrow keys” to finish',
      branch: 'chore/retire-old-editor',
      ageHours: 0.7,
      waitsOn: ['task-old-banner', 'task-gallery-shortcuts'],
      gate: {
        type: 'failure',
        title: '“Banner for the old editor” was cancelled',
        body: 'This task was waiting for it to finish. Retry to keep waiting on “Move through the paywall gallery with arrow keys” only, wait for another task instead, or cancel this one.',
      },
    },
    {
      id: 'task-gallery-shortcuts',
      request: 'Arrow keys should move between paywalls in the gallery.',
      title: 'Move through the paywall gallery with arrow keys',
      repo: paywall,
      size: 'small',
      priority: 'low',
      stage: 'planning',
      reason: 'planning the phases',
      branch: 'feat/gallery-arrow-keys',
      ageHours: 0.8,
      runs: [{ role: 'agent', purpose: 'plan', minutes: 0, summary: '' }],
    },
    {
      id: 'task-webhook-signing',
      request: 'Sign outgoing webhooks so customers can verify them.',
      title: 'Sign outgoing webhooks',
      repo: paywall,
      size: 'small',
      priority: 'high',
      stage: 'planning',
      reason: 'planning the phases',
      branch: 'feat/webhook-signing',
      ageHours: 0.4,
      runs: [{ role: 'agent', purpose: 'plan', minutes: 0, summary: '' }],
    },
  ];
}

function listReviewTasks({ paywall }: SeedRepos, worktrees: SeedWorktrees): SeedTask[] {
  const duplicatePath = worktrees.duplicate;
  const tabsPath = worktrees.tabs;
  return [
    {
      id: 'task-duplicate',
      request: 'Block duplicating code-first paywalls, they should be duplicated from the repo.',
      title: 'Refuse to duplicate code-first paywalls',
      repo: paywall,
      size: 'small',
      stage: 'awaiting_merge',
      reason: 'clean and ready to merge',
      branch: 'fix/code-first-duplicate',
      ageHours: 30,
      worktreePath: duplicatePath,
      report: {
        headline: 'Duplicating a code-first paywall now fails with a clear error.',
        sections: [
          {
            title: 'Guard the duplicate path',
            summary: 'duplicatePaywall throws a typed error for code-first paywalls.',
            spots: [
              spot(
                'src/paywalls/duplicate.ts',
                DUPLICATE_NEW,
                "if (source.kind === 'code_first')",
                'throw new PaywallError',
                'high',
                'The API maps PaywallError codes to 409; the dashboard shows the message as is.'
              ),
            ],
          },
          {
            title: 'Cover both kinds with tests',
            summary: 'One test per paywall kind.',
            spots: [
              spot(
                'src/paywalls/duplicate.test.ts',
                DUPLICATE_TEST_NEW,
                "it('refuses a code-first paywall'",
                'rejects.toThrow',
                'normal',
                'Fails on main, passes on this branch.'
              ),
            ],
          },
        ],
        checks: [
          { name: 'bun test', outcome: 'pass', detail: '2 new' },
          { name: 'CI', outcome: 'pass', detail: 'All 9 checks green' },
        ],
        judgementCalls: [],
      },
      runs: [
        { role: 'agent', purpose: 'build', minutes: 9, summary: 'Added the guard and tests.' },
        { role: 'reviewer', minutes: 2, summary: 'No findings.' },
        {
          role: 'agent',
          purpose: 'fix',
          fix: 'pull_request',
          minutes: 3,
          summary: 'Fixed the review-bot comment on #4531.',
        },
      ],
      pullRequest: { number: 4531, checks: 'passing' },
      gate: {
        type: 'merge',
        title: 'Merge #4531',
        body: 'Checks are green and the review-bot comment is resolved.',
      },
    },
    {
      id: 'task-command-registry',
      request: 'Rewrite the framework command registry so commands declare their own args and help text.',
      title: 'Rewrite the framework command registry',
      repo: paywall,
      size: 'large',
      planFirst: true,
      stage: 'awaiting_plan',
      reason: 'needs the plan approved before work starts',
      branch: 'refactor/command-registry',
      ageHours: 5,
      plan: {
        goal: 'Every framework command declares its arguments and help text in one place, so the CLI, the docs and the agents read the same definition.',
        phases: [
          {
            title: 'Define the command schema',
            detail: 'One declaration for arguments, flags and help text.',
          },
          {
            title: 'Port the existing commands',
            detail: 'Move every command onto the schema without changing behaviour.',
          },
          {
            title: 'Generate docs and help',
            detail: 'The CLI help and the docs page read the same definition.',
          },
          { title: 'Expose it to agents', detail: 'The MCP server lists commands from the schema.' },
          { title: 'Verify every command', detail: 'Snapshot the help output and run each command once.' },
        ],
        behaviour: [
          '`superwall help <command>` prints generated help.',
          'Unknown flags fail with the closest suggestion.',
          'The docs page for each command is generated from its definition.',
        ],
        approach:
          'Introduce defineCommand({ name, args, run }) and migrate the 31 commands in four batches. A codemod handles the 24 commands with plain flags; the rest are done by hand.',
        files: [
          { path: 'src/cli/registry.ts', change: 'New defineCommand and the registry.' },
          { path: 'src/cli/commands/*.ts', change: 'Migrated to defineCommand.' },
        ],
        outOfScope: ['Changing any command’s behaviour.'],
        verification: ['Snapshot of every command’s help output before and after.'],
        questions: [
          {
            question: 'Migrate all 31 commands in this task, or only the registry plus 3 examples?',
            options: ['All 31 commands', 'Registry and 3 examples'],
            recommendation: 'Registry and 3 examples',
          },
          {
            question: 'Keep the old flag parser as a fallback during the migration?',
            options: ['Keep it', 'Remove it'],
            recommendation: 'Keep it',
          },
        ],
      },
      runs: [
        {
          role: 'agent',
          purpose: 'plan',
          minutes: 8,
          summary: 'Proposed the registry plan with two open questions.',
        },
      ],
      gate: {
        type: 'plan',
        title: 'Approve the command registry plan',
        body: 'Two questions need your answer before building.',
      },
    },
    {
      id: 'task-tab-scroll',
      request: 'tab groups dont scroll horizontally when there are too many tabs',
      title: 'Scroll tab groups horizontally',
      repo: paywall,
      size: 'small',
      stage: 'awaiting_review',
      reason: 'built, checked and ready for review',
      branch: 'fix/tab-group-scroll',
      ageHours: 3,
      worktreePath: tabsPath,
      report: {
        headline: 'Tab groups scroll sideways and keep the active tab in view.',
        sections: [
          {
            title: 'Make the list scrollable',
            summary: 'The row scrolls horizontally with the scrollbar hidden; tabs no longer shrink.',
            spots: [
              spot(
                'src/ui/tab-group.tsx',
                TAB_GROUP_NEW,
                '<div ref={listRef}',
                "className='shrink-0'",
                'normal',
                'Hidden scrollbar: there is no visual hint more tabs exist off-screen.'
              ),
            ],
          },
          {
            title: 'Keep the active tab visible',
            summary: 'Selecting a tab scrolls it to the centre.',
            spots: [
              spot(
                'src/ui/tab-group.tsx',
                TAB_GROUP_NEW,
                'React.useEffect',
                '}, [active]);',
                'high',
                'Smooth scrolling runs on first render too, so the row animates on page load.'
              ),
            ],
          },
        ],
        checks: [{ name: 'bun lint', outcome: 'pass', detail: null }],
        judgementCalls: [],
      },
      findings: [
        {
          severity: 'suggestion',
          file: 'src/ui/tab-group.tsx',
          line: lineOf(TAB_GROUP_NEW, "behavior: 'smooth'"),
          message: 'Use instant scrolling on mount and smooth only on user selection.',
        },
      ],
      runs: [
        { role: 'agent', purpose: 'build', minutes: 7, summary: 'Made the row scrollable.' },
        { role: 'reviewer', minutes: 2, summary: 'One suggestion.' },
      ],
      gate: {
        type: 'review',
        title: 'Review the tab group scroll fix',
        body: 'Small fix, one suggestion from the agent review.',
      },
    },
  ];
}

function listActiveTasks({ paywall, docs }: SeedRepos): SeedTask[] {
  return [
    {
      id: 'task-export-retry',
      request: 'ClickHouse export times out on big apps, retry it',
      title: 'Retry ClickHouse exports that time out',
      repo: paywall,
      size: 'small',
      stage: 'building',
      reason: 'waiting on your answer',
      branch: 'fix/clickhouse-export-retry',
      ageHours: 2,
      runs: [{ role: 'agent', purpose: 'build', minutes: 5, summary: 'Asked how many retries.' }],
      gate: {
        type: 'question',
        title: 'Retry the whole export or only the failed chunk?',
        body: 'Exports run in 50k-row chunks. Retrying only the failed chunk is faster but needs the chunk offset persisted. Retrying the whole export is simpler and takes up to 4 minutes for the largest app.',
      },
    },
    {
      id: 'task-preview-flash',
      request: 'paywall preview flashes white on load in dark mode',
      title: 'Stop the paywall preview flashing on load',
      repo: paywall,
      size: 'small',
      stage: 'building',
      reason: 'stopped and needs a decision',
      branch: 'fix/preview-flash',
      ageHours: 6,
      runs: [
        {
          role: 'agent',
          purpose: 'build',
          minutes: 12,
          summary: 'Could not reproduce in the headless browser.',
          failed: true,
        },
      ],
      gate: {
        type: 'failure',
        title: 'The agent could not reproduce the flash',
        body: 'The preview renders dark from the first frame in headless Chromium. It may only happen in Safari or with a cold cache. Try again with Safari, or close the task?',
      },
    },
    {
      id: 'task-stream-tools',
      request: 'MCP v2: stream tool results instead of buffering them',
      title: 'Stream MCP tool results',
      repo: paywall,
      size: 'small',
      stage: 'building',
      reason: 'building',
      branch: 'feat/mcp-stream-tools',
      ageHours: 1,
      runs: [{ role: 'agent', purpose: 'build', minutes: 4, summary: 'Streaming the tool results.' }],
    },
    {
      id: 'task-effect-orm',
      request: 'bump @maple-dev/effect-orm to 0.7.1',
      title: 'Bump effect-orm to 0.7.1',
      repo: paywall,
      size: 'small',
      stage: 'checking',
      reason: 'running checks',
      branch: 'chore/effect-orm-0-7-1',
      ageHours: 0.5,
      runs: [{ role: 'agent', purpose: 'build', minutes: 3, summary: 'Bumped and fixed one type.' }],
    },
    {
      id: 'task-docs-gate',
      request: 'Drop the Superwall for Agents access gate from the framework docs',
      title: 'Remove the access gate from the framework docs',
      repo: docs,
      size: 'small',
      stage: 'merged',
      reason: 'merged',
      branch: 'docs/drop-access-gate',
      ageHours: 50,
      pullRequest: { number: 339, checks: 'passing' },
      merged: true,
    },
  ];
}

function listPersonalTasks({ paywall, kanna, prints }: SeedRepos, worktrees: SeedWorktrees): SeedTask[] {
  const defaultsPath = worktrees.defaults;
  return [
    {
      id: 'task-usage-defaults',
      request: 'pick a cheaper default model when the usage window is almost used up',
      title: 'Fall back to a cheaper model near the usage limit',
      repo: kanna,
      size: 'small',
      priority: 'low',
      stage: 'awaiting_review',
      reason: 'built, checked and ready for review',
      branch: 'feat/usage-aware-defaults',
      ageHours: 70,
      worktreePath: defaultsPath,
      report: {
        headline: 'New chats default to a cheaper model once 85% of the usage window is spent.',
        sections: [
          {
            title: 'Choose the model from usage',
            summary: 'resolveDefaultModel takes the usage window and falls back above 85%.',
            spots: [
              spot(
                'src/shared/defaults.ts',
                DEFAULTS_NEW,
                'export function resolveDefaultModel',
                'return resolveFallbackModel(provider);',
                'high',
                'A missing usage window keeps the preferred model, so accounts without usage data never fall back.'
              ),
            ],
          },
        ],
        checks: [{ name: 'bun test', outcome: 'pass', detail: null }],
        judgementCalls: [
          {
            call: 'Threshold at 85%',
            reason: 'Leaves room to finish a long turn on the preferred model.',
            file: 'src/shared/defaults.ts',
            line: 4,
          },
        ],
      },
      provider: 'codex',
      runs: [{ role: 'agent', purpose: 'build', minutes: 11, summary: 'Added the fallback.' }],
      extra: [
        {
          type: 'evidence.attached',
          evidence: {
            id: 'evidence-usage-defaults-test',
            taskId: 'task-usage-defaults',
            runId: 'task-usage-defaults-run-0',
            kind: 'test',
            title: 'bun test src/shared',
            uri: `/api/evidence/${DEFAULTS_TEST_EVIDENCE}`,
            attachedAt: NOW - 69 * HOUR,
          },
        },
      ],
      gate: { type: 'review', title: 'Review the usage-aware defaults', body: 'Ready for review.' },
    },
    {
      id: 'task-dark-contrast',
      request: 'settings dark mode contrast is too low',
      title: 'Raise contrast in dark settings',
      repo: kanna,
      size: 'small',
      stage: 'merged',
      reason: 'merged',
      branch: 'fix/dark-settings-contrast',
      ageHours: 96,
      pullRequest: { number: 212, checks: 'passing' },
      merged: true,
      runs: [
        {
          role: 'agent',
          purpose: 'build',
          minutes: 6,
          summary: 'Raised the muted text and border tokens in dark mode.',
        },
        { role: 'reviewer', minutes: 2, summary: 'No findings.' },
        { role: 'agent', purpose: 'fix', fix: 'you', minutes: 3, summary: 'Raised the disabled text too.' },
      ],
      revision: {
        afterRun: 1,
        response: 'The disabled labels are still too faint. Raise them with the rest.',
      },
    },
    {
      id: 'task-print-retries',
      request: 'print jobs should retry when the printer is offline',
      title: 'Retry print jobs when the printer is offline',
      repo: prints,
      size: 'large',
      planFirst: true,
      stage: 'planning',
      reason: 'writing the plan',
      branch: 'feat/print-retries',
      ageHours: 0.3,
      runs: [{ role: 'agent', purpose: 'plan', minutes: 0, summary: '' }],
    },
    {
      id: 'task-old-banner',
      request: 'add a banner for the old editor',
      title: 'Banner for the old editor',
      repo: paywall,
      size: 'small',
      stage: 'cancelled',
      reason: 'cancelled',
      branch: 'feat/old-editor-banner',
      ageHours: 120,
    },
  ];
}

function listTasks(repos: SeedRepos, worktrees: SeedWorktrees): SeedTask[] {
  const { paywall, kanna, basketSdk, basketServer } = repos;
  return [
    ...listEmbeddedChatTasks(repos, worktrees),
    ...listBacklogTasks(repos),
    ...listReviewTasks(repos, worktrees),
    ...listActiveTasks(repos),
    ...listPersonalTasks(repos, worktrees),
    ...listBasketTasks({ basketServer, basketSdk }),
    ...listProcessTasks({ paywall, kanna }),
    ...listShapeTasks({ paywall, kanna }),
    ...listDelegationTasks({ paywall }),
    ...listTriggerTasks({ paywall, kanna }),
    ...listRoundTasks({ paywall }, worktrees.rounds),
  ];
}

function seed() {
  rmSync(ROOT, { recursive: true, force: true });
  mkdirSync(WORKTREES, { recursive: true });
  const repos = createRepos();
  const sample = createCodeSample(REPOS, WORKTREES);
  const projects = [...createProjects(), sample.project];
  const tasks = [...listTasks(repos, createWorktrees(repos)), ...listCodeTasks(sample)];

  const log = new EventLog(join(DATA, 'shinsa.sqlite'));
  const timeline = stampRunPrompts(buildEvents(tasks, projects, [...Object.values(repos), sample.repo]));
  let seq = 0;
  for (const { at, event } of timeline) {
    log.commitCommand({ events: [event], effects: [], cancellations: [], fromSeq: seq, at, receipt: null });
    seq += 1;
  }
  log.close();
  writeFileSync(
    join(DATA, 'config.json'),
    `${JSON.stringify({ version: 1, roots: [REPOS], onboardedAt: NOW }, null, 2)}\n`
  );
  writeAccountFiles(DATA);
  const transcripts = join(DATA, 'transcripts');
  mkdirSync(transcripts, { recursive: true });
  const runTimes = listRunTimes(tasks, timeline);
  for (const [runId, times] of runTimes) {
    const live = times.endedAt === null;
    const events = buildRunEvents(times, live);
    writeTranscript(transcripts, runId, spreadEvents(events, times.startedAt, times.endedAt ?? NOW - MINUTE));
  }
  writeDelegationTranscripts(transcripts, timeline);
  writeCodeTranscripts(transcripts, timeline, sample);
  writeEvidenceFiles();
  writeAccountTranscripts(transcripts);
  const session = Bun.env.SHINSA_SEED_SESSION;
  if (session) writeSessionTranscript(session, runTimes, transcripts);
  console.info(`Seeded ${tasks.length} tasks into ${DATA}`);
  console.info(
    `Run: SHINSA_DATA_DIR=${DATA} SHINSA_INSPECT=1 SHINSA_PORT=5190 bun run --cwd apps/server start`
  );
}

seed();
