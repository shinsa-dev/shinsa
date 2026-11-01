import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { convertClaudeSession } from '../apps/engine/src/agents/index.ts';
import { EventLog } from '../apps/engine/src/store/index.ts';
import type {
  CodeSpot,
  Feedback,
  Gate,
  MemoryEntry,
  PipelineStep,
  PlanDocument,
  Project,
  PullRequest,
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
  isSamePipeline,
  NO_PROJECT_KEY,
  RUN_AGENT_ROLE,
  resolveHandOverPipeline,
  resolveMergeStepKey,
  SHAPE_PIPELINES,
  serializePlanMarkdown,
} from '../packages/core/src/index.ts';
import { createCodeSample, listCodeTasks } from './seed-code.ts';
import { writeCodeTranscripts } from './seed-code-transcripts.ts';
import { listDelegationTasks, writeDelegationTranscripts } from './seed-delegation.ts';
import { listSeedEvidenceEvents, writeSeedEvidence } from './seed-evidence.ts';
import {
  CHOSEN_BY_YOU,
  callTool,
  createPlanCheck,
  createSeedClock,
  DAY,
  HOUR,
  listSeedCheckResults,
  listSeedIterations,
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
import { EXPORT_FILES_BASE, EXPORT_FILES_NEW, listProcessTasks } from './seed-process.ts';
import { resolveRunOpening, stampRunPrompts } from './seed-prompts.ts';
import { listRoundTasks } from './seed-rounds.ts';
import { listShapeTasks, resolveShapeHandover } from './seed-shapes.ts';
import { listHistoryTasks } from './seed-stats.ts';
import { listTriggerTasks, writeAccountFiles, writeAccountTranscripts } from './seed-triggers.ts';

const ROOT = Bun.env.SHINSA_SEED_DIR ?? join(homedir(), '.shinsa-seed');
const DATA = join(ROOT, 'data');
const REPOS = join(ROOT, 'repos');
const WORKTREES = join(DATA, 'worktrees');

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

interface SpotNote {
  title: string;
  why: string;
  explain: string;
}

function spot(
  file: string,
  content: string,
  from: string,
  to: string,
  attention: CodeSpot['attention'],
  note: SpotNote
): CodeSpot {
  return { file, start: lineOf(content, from), end: lineOf(content, to), attention, ...note };
}

function rangeOf(content: string, from: string, to: string) {
  return { line: lineOf(content, from), end: lineOf(content, to) };
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

const MCP_SESSION_TEST_NEW = `import { describe, expect, it } from 'bun:test';
import { startFakeMcpServer } from '../test/fake-mcp-server';
import { McpSession } from './mcp-session';

describe('McpSession', () => {
  it('gives up after three failed connects', async () => {
    const server = await startFakeMcpServer({ refuse: true });
    const session = new McpSession(server.url, { paywallId: 'pw_1' });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await expect(session.ensureConnected()).rejects.toThrow();
    }
    await expect(session.ensureConnected()).rejects.toThrow('The MCP server is unreachable.');
    await server.stop();
  });

  it('sends the paywall id on every request', async () => {
    const server = await startFakeMcpServer();
    const session = new McpSession(server.url, { paywallId: 'pw_1' });
    await session.ensureConnected();
    await Array.fromAsync(session.complete([], {}));
    expect(server.requests.every((request) => request.headers['x-paywall-id'] === 'pw_1')).toBe(true);
    await session.close();
    await server.stop();
  });

  it('yields tool results as their own parts', async () => {
    const server = await startFakeMcpServer({
      content: [
        { type: 'text', text: 'Updating the headline.' },
        { type: 'tool_result', name: 'paywall.update', text: 'Saved.' },
      ],
    });
    const session = new McpSession(server.url, { paywallId: 'pw_1' });
    await session.ensureConnected();
    const parts = await Array.fromAsync(session.complete([], {}));
    expect(parts.map((part) => part.kind)).toEqual(['text', 'tool_result']);
    await session.close();
    await server.stop();
  });
});
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

const KANNA_THEME = `:root {
  --background: #ffffff;
  --panel: #f6f6f7;
  --text: #18191b;
  --muted: #5d6068;
  --border: #e2e3e6;
  --disabled: #9a9ca3;
}

.dark {
  --background: #111113;
  --panel: #18191b;
  --text: #ededef;
  --muted: #a1a4ab;
  --border: #3a3c42;
  --disabled: #6f727a;
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

const PARSE_FLAGS_BASE = `export interface ParseOptions {
  boolean?: string[];
  string?: string[];
  alias?: Record<string, string>;
  default?: Record<string, unknown>;
}

export type ParsedFlags = Record<string, unknown> & { _: string[] };

export function parseFlags(argv: string[], options: ParseOptions = {}): ParsedFlags {
  const flags: ParsedFlags = { ...options.default, _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] ?? '';
    if (!token.startsWith('-')) {
      flags._.push(token);
      continue;
    }
    const body = token.replace(/^--?/, '');
    if (body.startsWith('no-')) {
      flags[body.slice(3)] = false;
      continue;
    }
    const [raw = '', ...rest] = body.split('=');
    const name = options.alias?.[raw] ?? raw;
    if (options.boolean?.includes(name)) {
      flags[name] = true;
      continue;
    }
    flags[name] = rest.length > 0 ? rest.join('=') : argv[++index];
  }
  return flags;
}
`;

const CLI_INDEX_BASE = `import * as commands from './commands';

const USAGE = 'Usage: superwall <command> [flags]';

export async function main(argv: string[]) {
  const [name = 'help', ...rest] = argv;
  const command = commands[toExportName(name) as keyof typeof commands];
  if (!command) {
    console.error(\`Unknown command: \${name}\\n\\n\${USAGE}\`);
    process.exit(1);
  }
  await command.run(rest);
}

function toExportName(name: string) {
  return name.replace(/-(\\w)/g, (_, letter: string) => letter.toUpperCase());
}
`;

const DEPLOY_BASE = `import { runDeploy } from '../../actions/deploy';
import { parseFlags } from '../parse-flags';

export const description = 'Build, publish and promote in one step';

export async function run(argv: string[]) {
  const flags = parseFlags(argv, { string: ['app', 'message', 'wait'], alias: { m: 'message' } });
  const [environment] = flags._;
  if (!environment) throw new Error('deploy needs an environment: staging or production');
  await runDeploy({ environment, app: flags.app, message: flags.message, wait: Number(flags.wait ?? 120) });
}
`;

const LOGIN_BASE = `import { runLogin } from '../../actions/login';
import { parseFlags } from '../parse-flags';
import { readStdin } from '../stdin';

export const description = 'Sign in with a browser or an API token';

export async function run(argv: string[]) {
  const flags = parseFlags(argv, { string: ['token'] });
  const token = flags.token === '-' ? await readStdin() : (flags.token as string | undefined);
  await runLogin({ token });
}
`;

const LOGS_BASE = `import { runLogs } from '../../actions/logs';
import { parseFlags } from '../parse-flags';

export const description = 'Stream the paywall event logs of the app';

export async function run(argv: string[]) {
  const flags = parseFlags(argv, {
    boolean: ['follow'],
    string: ['app', 'since', 'limit'],
    alias: { f: 'follow' },
    default: { since: '10m', limit: '200' },
  });
  await runLogs({ ...flags, limit: Number(flags.limit) });
}
`;

const REGISTRY_NEW = `import { parseFlags } from './parse-flags';
import { suggestName } from './suggest';

export type FlagKind = 'string' | 'boolean' | 'number';

type FlagValue<K extends FlagKind> = K extends 'boolean' ? boolean : K extends 'number' ? number : string;

export interface FlagSpec<K extends FlagKind = FlagKind> {
  kind: K;
  help: string;
  alias?: string;
  default?: FlagValue<K>;
}

export interface ArgSpec {
  name: string;
  help: string;
  required: boolean;
}

type FlagValues<F extends Record<string, FlagSpec>> = { [K in keyof F]: FlagValue<F[K]['kind']> | undefined };

export interface CommandDefinition<F extends Record<string, FlagSpec> = Record<string, FlagSpec>> {
  name: string;
  summary: string;
  args?: ArgSpec[];
  flags: F;
  hidden?: boolean;
  agents?: boolean;
  run: (input: { args: string[]; flags: FlagValues<F> }) => Promise<void>;
}

export class UsageError extends Error {}

function createFlag<K extends FlagKind>(kind: K) {
  return (help: string, options: Omit<FlagSpec<K>, 'kind' | 'help'> = {}): FlagSpec<K> => ({
    kind,
    help,
    ...options,
  });
}

export const flag = {
  string: createFlag('string'),
  boolean: createFlag('boolean'),
  number: createFlag('number'),
};

export function defineCommand<F extends Record<string, FlagSpec>>(definition: CommandDefinition<F>) {
  return definition as unknown as CommandDefinition;
}

export function parseInput(command: CommandDefinition, argv: string[]) {
  const flags: Record<string, unknown> = {};
  const args: string[] = [];
  for (const [name, spec] of Object.entries(command.flags)) flags[name] = spec.default;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] ?? '';
    if (!token.startsWith('-') || token === '-') {
      args.push(token);
      continue;
    }
    const [raw = '', inline] = token.replace(/^--?/, '').split('=', 2);
    const name = resolveFlagName(command, raw);
    const spec = command.flags[name];
    if (!spec) throw new UsageError(describeUnknownFlag(command, raw));
    if (spec.kind === 'boolean') {
      flags[name] = inline !== 'false';
      continue;
    }
    const value = inline ?? argv[++index];
    if (value === undefined) throw new UsageError(\`--\${name} needs a value.\`);
    flags[name] = spec.kind === 'number' ? Number(value) : value;
  }
  assertArgs(command, args);
  return { args, flags };
}

function resolveFlagName(command: CommandDefinition, raw: string) {
  const aliased = Object.entries(command.flags).find(([, spec]) => spec.alias === raw);
  return aliased?.[0] ?? raw;
}

function describeUnknownFlag(command: CommandDefinition, raw: string) {
  const suggestion = suggestName(raw, Object.keys(command.flags));
  const hint = suggestion ? \` Did you mean --\${suggestion}?\` : '';
  return \`Unknown flag --\${raw} for \${command.name}.\${hint}\`;
}

function assertArgs(command: CommandDefinition, args: string[]) {
  const required = (command.args ?? []).filter((arg) => arg.required);
  if (args.length < required.length) {
    throw new UsageError(\`\${command.name} needs <\${required[args.length]?.name}>.\`);
  }
}

export function parseLegacyInput(command: CommandDefinition, argv: string[]) {
  const parsed = parseFlags(argv, {
    boolean: Object.keys(command.flags).filter((name) => command.flags[name]?.kind === 'boolean'),
  });
  return { args: parsed._, flags: parsed };
}
`;

const SUGGEST_NEW = `const MAX_DISTANCE = 2;

export function suggestName(input: string, names: string[]) {
  let best: { name: string; distance: number } | null = null;
  for (const name of names) {
    const distance = countEdits(input, name);
    if (distance <= MAX_DISTANCE && (!best || distance < best.distance)) best = { name, distance };
  }
  return best?.name ?? null;
}

function countEdits(a: string, b: string) {
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let previous = row[0] ?? 0;
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const current = row[j] ?? 0;
      row[j] = Math.min(current + 1, (row[j - 1] ?? 0) + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return row[b.length] ?? 0;
}
`;

const HELP_NEW = `import type { CommandDefinition } from './registry';

export function renderHelp(command: CommandDefinition) {
  const args = (command.args ?? []).map((arg) => (arg.required ? \`<\${arg.name}>\` : \`[\${arg.name}]\`));
  const lines = [\`Usage: superwall \${[command.name, ...args, '[flags]'].join(' ')}\`, '', command.summary];
  const flags = Object.entries(command.flags);
  if (flags.length > 0) {
    lines.push('', 'Flags:');
    const width = Math.max(...flags.map(([name]) => name.length));
    for (const [name, spec] of flags) {
      const alias = spec.alias ? \`-\${spec.alias}, \` : '    ';
      const fallback = spec.default === undefined ? '' : \` (default: \${spec.default})\`;
      lines.push(\`  \${alias}--\${name.padEnd(width)}  \${spec.help}\${fallback}\`);
    }
  }
  return lines.join('\\n');
}

export function renderCommandList(commands: readonly CommandDefinition[]) {
  const visible = commands.filter((command) => !command.hidden);
  const width = Math.max(...visible.map((command) => command.name.length));
  return visible.map((command) => \`  \${command.name.padEnd(width)}  \${command.summary}\`).join('\\n');
}
`;

const CLI_INDEX_NEW = `import { COMMANDS } from './commands';
import { renderCommandList, renderHelp } from './help';
import { parseInput, parseLegacyInput, UsageError } from './registry';

const BY_NAME = new Map(COMMANDS.map((command) => [command.name, command]));

export async function main(argv: string[], env = process.env) {
  const [name = 'help', ...rest] = argv;
  if (name === 'help' || name === '--help') return printHelp(rest[0]);
  const command = BY_NAME.get(name);
  if (!command) return fail(\`Unknown command: \${name}\`, renderCommandList(COMMANDS));
  if (rest.includes('--help')) return console.log(renderHelp(command));
  try {
    const legacy = env.SUPERWALL_LEGACY_FLAGS === '1';
    await command.run(legacy ? parseLegacyInput(command, rest) : parseInput(command, rest));
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    fail(error.message, renderHelp(command));
  }
}

function printHelp(name: string | undefined) {
  const command = name ? BY_NAME.get(name) : undefined;
  if (command) return console.log(renderHelp(command));
  console.log(\`Usage: superwall <command> [flags]\\n\\n\${renderCommandList(COMMANDS)}\`);
}

function fail(message: string, help: string): never {
  console.error(\`\${message}\\n\\n\${help}\`);
  process.exit(2);
}
`;

const DEPLOY_NEW = `import { runDeploy } from '../../actions/deploy';
import { defineCommand, flag } from '../registry';

export default defineCommand({
  name: 'deploy',
  summary: 'Build, publish and promote in one step',
  args: [{ name: 'environment', help: 'staging or production', required: true }],
  flags: {
    app: flag.string('The app to deploy; defaults to the linked one'),
    message: flag.string('A note shown in the dashboard history', { alias: 'm' }),
    wait: flag.number('Seconds to wait for the rollout before returning', { default: 120 }),
  },
  run: ({ args, flags }) => runDeploy({ environment: args[0] ?? 'staging', ...flags }),
});
`;

const LOGIN_NEW = `import { runLogin } from '../../actions/login';
import { defineCommand, flag } from '../registry';
import { readStdin } from '../stdin';

export default defineCommand({
  name: 'login',
  summary: 'Sign in with a browser or an API token',
  agents: false,
  flags: {
    token: flag.string('An API token; pass - to read it from stdin'),
  },
  run: async ({ flags }) => {
    const token = flags.token === '-' ? await readStdin() : flags.token;
    await runLogin({ token });
  },
});
`;

const LOGS_NEW = `import { runLogs } from '../../actions/logs';
import { defineCommand, flag } from '../registry';

export default defineCommand({
  name: 'logs',
  summary: 'Stream the paywall event logs of the app',
  flags: {
    app: flag.string('The app to read; defaults to the linked one'),
    since: flag.string('How far back to start, such as 10m or 2h', { default: '10m' }),
    limit: flag.number('The most events to print', { default: 200 }),
    follow: flag.boolean('Keep streaming new events', { alias: 'f' }),
  },
  run: ({ flags }) => runLogs(flags),
});
`;

const CODEMOD_NEW = `import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { Glob } from 'bun';
import FLAG_HELP from './flag-help.json';

interface LegacyOptions {
  boolean?: string[];
  string?: string[];
  default?: Record<string, unknown>;
}

const PARSE_CALL = /parseFlags\\(argv, (\\{.*\\})\\);/;
const DESCRIPTION = /export const description = '([^']*)';/;
const ACTION_CALL = /await (run\\w+)\\(flags\\);/;

for (const path of new Glob('src/cli/commands/*.ts').scanSync()) {
  const source = readFileSync(path, 'utf8');
  const parse = PARSE_CALL.exec(source);
  const action = ACTION_CALL.exec(source)?.[1];
  if (!parse?.[1] || !action || source.includes('flags._')) {
    console.warn(\`Skipped \${path}: port it by hand.\`);
    continue;
  }
  const options = Function(\`return (\${parse[1]})\`)() as LegacyOptions;
  const name = basename(path, '.ts');
  writeFileSync(path, renderCommand(name, DESCRIPTION.exec(source)?.[1] ?? '', options, action));
}

function renderCommand(name: string, summary: string, options: LegacyOptions, action: string) {
  const flags = [
    ...(options.string ?? []).map((flag) => renderFlag(name, flag, 'string', options.default?.[flag])),
    ...(options.boolean ?? []).map((flag) => renderFlag(name, flag, 'boolean', options.default?.[flag])),
  ];
  return [
    \`import { \${action} } from '../../actions/\${name}';\`,
    "import { defineCommand, flag } from '../registry';",
    '',
    'export default defineCommand({',
    \`  name: '\${name}',\`,
    \`  summary: '\${summary}',\`,
    \`  flags: {\${flags.length > 0 ? \`\\n\${flags.join('\\n')}\\n  \` : ''}},\`,
    \`  run: ({ flags }) => \${action}(flags),\`,
    '});',
    '',
  ].join('\\n');
}

function renderFlag(command: string, name: string, kind: string, fallback: unknown) {
  const help = (FLAG_HELP as Record<string, string>)[\`\${command}.\${name}\`] ?? '';
  const options = fallback === undefined ? '' : \`, { default: \${JSON.stringify(fallback)} }\`;
  return \`    \${name}: flag.\${kind}('\${help}'\${options}),\`;
}
`;

const DOCS_SCRIPT_NEW = `import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { COMMANDS } from '../src/cli/commands';
import { renderHelp } from '../src/cli/help';

const OUT = 'docs/cli';

const visible = COMMANDS.filter((command) => !command.hidden);
mkdirSync(OUT, { recursive: true });
for (const command of visible) {
  const page = [\`# superwall \${command.name}\`, '', command.summary, '', '\`\`\`text', renderHelp(command), '\`\`\`', ''];
  writeFileSync(join(OUT, \`\${command.name}.mdx\`), page.join('\\n'));
}
const index = visible.map((command) => \`- [\${command.name}](./\${command.name}): \${command.summary}\`);
writeFileSync(join(OUT, 'index.mdx'), \`# Commands\\n\\n\${index.join('\\n')}\\n\`);
`;

const MCP_COMMANDS_NEW = `import { COMMANDS } from '../cli/commands';
import type { CommandDefinition } from '../cli/registry';

export function listCommandTools() {
  return COMMANDS.filter((command) => !command.hidden && command.agents !== false).map((command) => ({
    name: \`superwall.\${command.name}\`,
    description: command.summary,
    inputSchema: resolveInputSchema(command),
  }));
}

function resolveInputSchema(command: CommandDefinition) {
  const properties: Record<string, { type: string; description: string }> = {};
  for (const [name, spec] of Object.entries(command.flags)) {
    properties[name] = { type: spec.kind, description: spec.help };
  }
  const args = command.args ?? [];
  if (args.length > 0) {
    properties.args = { type: 'array', description: args.map((arg) => \`\${arg.name}: \${arg.help}\`).join('; ') };
  }
  return { type: 'object', properties, required: args.some((arg) => arg.required) ? ['args'] : [] };
}
`;

const HELP_TEST_NEW = `import { describe, expect, it } from 'bun:test';
import { COMMANDS } from './commands';
import { renderHelp } from './help';
import { parseInput } from './registry';

describe('command help', () => {
  for (const command of COMMANDS) {
    it(\`matches the snapshot for \${command.name}\`, () => {
      expect(renderHelp(command)).toMatchSnapshot();
    });
  }

  it('gives every flag a help text', () => {
    const missing = COMMANDS.flatMap((command) =>
      Object.entries(command.flags)
        .filter(([, spec]) => spec.help === '')
        .map(([name]) => \`\${command.name} --\${name}\`)
    );
    expect(missing).toEqual([]);
  });
});

describe('parseInput', () => {
  const push = COMMANDS.find((command) => command.name === 'push');

  it('suggests the closest flag', () => {
    expect(() => push && parseInput(push, ['--apps', 'demo'])).toThrow('Did you mean --app?');
  });

  it('asks for a missing argument', () => {
    const deploy = COMMANDS.find((command) => command.name === 'deploy');
    expect(() => deploy && parseInput(deploy, [])).toThrow('deploy needs <environment>.');
  });
});
`;

const TAB_GROUP_TEST_NEW = `import { describe, expect, it, mock } from 'bun:test';
import { render } from '@testing-library/react';
import { TabGroup } from './tab-group';

const TABS = Array.from({ length: 40 }, (_, index) => ({ id: \`tab-\${index}\`, label: \`Tab \${index}\` }));

describe('TabGroup', () => {
  it('scrolls the active tab to the centre', () => {
    const scrollIntoView = mock();
    Element.prototype.scrollIntoView = scrollIntoView;
    const view = render(<TabGroup tabs={TABS} active='tab-0' onSelect={() => {}} />);
    view.rerender(<TabGroup tabs={TABS} active='tab-31' onSelect={() => {}} />);
    expect(scrollIntoView).toHaveBeenLastCalledWith({ block: 'nearest', inline: 'center', behavior: 'smooth' });
  });

  it('keeps every tab at its natural width', () => {
    const view = render(<TabGroup tabs={TABS} active='tab-0' onSelect={() => {}} />);
    expect(view.getAllByRole('button').every((tab) => tab.classList.contains('shrink-0'))).toBe(true);
  });
});
`;

const DEFAULTS_TEST_NEW = `import { describe, expect, it } from 'bun:test';
import { resolveDefaultModel } from './defaults';

const RESETS_AT = Date.UTC(2026, 9, 26, 18);

describe('resolveDefaultModel', () => {
  it('keeps the preferred model below 85%', () => {
    expect(resolveDefaultModel('claude', { used: 84, limit: 100, resetsAt: RESETS_AT })).toBe('claude-opus-5-5');
  });

  it('falls back at 85% of the window', () => {
    expect(resolveDefaultModel('claude', { used: 85, limit: 100, resetsAt: RESETS_AT })).toBe('claude-sonnet-5-5');
    expect(resolveDefaultModel('codex', { used: 85, limit: 100, resetsAt: RESETS_AT })).toBe('gpt-6-mini');
  });

  it('keeps the preferred model without usage data', () => {
    expect(resolveDefaultModel('claude', null)).toBe('claude-opus-5-5');
  });
});
`;

interface CliFlag {
  name: string;
  kind: 'string' | 'boolean';
  help: string;
  fallback?: boolean;
}

interface CliCommand {
  name: string;
  summary: string;
  flags: CliFlag[];
}

const APP_FLAG: CliFlag = { name: 'app', kind: 'string', help: 'The app to use; defaults to the linked one' };

const JSON_FLAG: CliFlag = { name: 'json', kind: 'boolean', help: 'Print the result as JSON' };

function createListCommand(name: string, noun: string): CliCommand {
  return { name, summary: `List the ${noun} of the app`, flags: [APP_FLAG, JSON_FLAG] };
}

const CLI_COMMANDS: CliCommand[] = [
  {
    name: 'push',
    summary: 'Upload the local paywalls to the dashboard',
    flags: [
      APP_FLAG,
      JSON_FLAG,
      {
        name: 'cache',
        kind: 'boolean',
        help: 'Reuse assets that did not change since the last push',
        fallback: true,
      },
    ],
  },
  {
    name: 'pull',
    summary: 'Download the dashboard paywalls into this folder',
    flags: [APP_FLAG, { name: 'force', kind: 'boolean', help: 'Overwrite local changes' }],
  },
  { name: 'logout', summary: 'Sign out and forget the stored token', flags: [] },
  { name: 'whoami', summary: 'Show the signed-in account', flags: [JSON_FLAG] },
  {
    name: 'init',
    summary: 'Create a superwall.config.ts in this folder',
    flags: [{ name: 'template', kind: 'string', help: 'The template to start from' }],
  },
  {
    name: 'dev',
    summary: 'Serve the paywalls locally with live reload',
    flags: [{ name: 'port', kind: 'string', help: 'The port to serve on' }],
  },
  {
    name: 'build',
    summary: 'Bundle the paywalls for publishing',
    flags: [{ name: 'out', kind: 'string', help: 'Where to write the bundle' }],
  },
  {
    name: 'preview',
    summary: 'Open a paywall in the device preview',
    flags: [{ name: 'device', kind: 'string', help: 'The device to preview on' }],
  },
  { name: 'publish', summary: 'Publish a built bundle to the dashboard', flags: [APP_FLAG, JSON_FLAG] },
  {
    name: 'promote',
    summary: 'Promote a published version to production',
    flags: [APP_FLAG, { name: 'version', kind: 'string', help: 'The version to promote' }],
  },
  {
    name: 'rollback',
    summary: 'Roll production back to the previous version',
    flags: [APP_FLAG, { name: 'yes', kind: 'boolean', help: 'Skip the confirmation' }],
  },
  { name: 'status', summary: 'Show the deploy status of the app', flags: [APP_FLAG, JSON_FLAG] },
  { name: 'open', summary: 'Open the app in the dashboard', flags: [APP_FLAG] },
  { name: 'link', summary: 'Link this folder to a dashboard app', flags: [APP_FLAG] },
  { name: 'unlink', summary: 'Forget the dashboard app linked to this folder', flags: [] },
  createListCommand('env-list', 'environment variables'),
  {
    name: 'env-set',
    summary: 'Set an environment variable',
    flags: [
      APP_FLAG,
      { name: 'name', kind: 'string', help: 'The variable to set' },
      { name: 'value', kind: 'string', help: 'The value to store' },
    ],
  },
  {
    name: 'env-unset',
    summary: 'Remove an environment variable',
    flags: [APP_FLAG, { name: 'name', kind: 'string', help: 'The variable to remove' }],
  },
  createListCommand('products', 'products'),
  createListCommand('entitlements', 'entitlements'),
  createListCommand('campaigns', 'campaigns'),
  createListCommand('placements', 'placements'),
  createListCommand('paywalls', 'paywalls'),
  { name: 'templates', summary: 'List the paywall templates you can start from', flags: [JSON_FLAG] },
  {
    name: 'doctor',
    summary: 'Check the local setup for common problems',
    flags: [{ name: 'fix', kind: 'boolean', help: 'Fix what can be fixed automatically' }],
  },
  {
    name: 'upgrade',
    summary: 'Upgrade the CLI to the latest version',
    flags: [{ name: 'channel', kind: 'string', help: 'The release channel to follow' }],
  },
  {
    name: 'completion',
    summary: 'Print the shell completion script',
    flags: [{ name: 'shell', kind: 'string', help: 'The shell to print it for' }],
  },
  {
    name: 'migrate',
    summary: 'Move a dashboard paywall into this folder as code',
    flags: [{ name: 'id', kind: 'string', help: 'The paywall to move' }],
  },
];

const HAND_PORTED = ['deploy', 'login', 'logs'];

function resolveCamelName(name: string) {
  return name.replace(/-(\w)/g, (_, letter: string) => letter.toUpperCase());
}

function resolveActionName(name: string) {
  const camel = resolveCamelName(name);
  return `run${camel.charAt(0).toUpperCase()}${camel.slice(1)}`;
}

function listFlagNames(command: CliCommand, kind: CliFlag['kind']) {
  return command.flags.filter((flag) => flag.kind === kind).map((flag) => `'${flag.name}'`);
}

function serializeLegacyCommand(command: CliCommand) {
  const booleans = listFlagNames(command, 'boolean');
  const strings = listFlagNames(command, 'string');
  const defaults = command.flags.flatMap((flag) =>
    flag.fallback === undefined ? [] : [`${flag.name}: ${flag.fallback}`]
  );
  const options = [
    booleans.length > 0 ? `boolean: [${booleans.join(', ')}]` : null,
    strings.length > 0 ? `string: [${strings.join(', ')}]` : null,
    defaults.length > 0 ? `default: { ${defaults.join(', ')} }` : null,
  ].filter((option) => option !== null);
  const action = resolveActionName(command.name);
  return [
    `import { ${action} } from '../../actions/${command.name}';`,
    "import { parseFlags } from '../parse-flags';",
    '',
    `export const description = '${command.summary}';`,
    '',
    'export async function run(argv: string[]) {',
    `  const flags = parseFlags(argv, ${options.length > 0 ? `{ ${options.join(', ')} }` : '{}'});`,
    `  await ${action}(flags);`,
    '}',
    '',
  ].join('\n');
}

function serializeCommandFlag(flag: CliFlag) {
  const options = flag.fallback === undefined ? '' : `, { default: ${flag.fallback} }`;
  return `    ${flag.name}: flag.${flag.kind}('${flag.help}'${options}),`;
}

function serializeCommand(command: CliCommand) {
  const ordered = [
    ...command.flags.filter((flag) => flag.kind === 'string'),
    ...command.flags.filter((flag) => flag.kind === 'boolean'),
  ];
  const flags = ordered.length > 0 ? `\n${ordered.map(serializeCommandFlag).join('\n')}\n  ` : '';
  const action = resolveActionName(command.name);
  return [
    `import { ${action} } from '../../actions/${command.name}';`,
    "import { defineCommand, flag } from '../registry';",
    '',
    'export default defineCommand({',
    `  name: '${command.name}',`,
    `  summary: '${command.summary}',`,
    `  flags: {${flags}},`,
    `  run: ({ flags }) => ${action}(flags),`,
    '});',
    '',
  ].join('\n');
}

function listCliNames() {
  return [...CLI_COMMANDS.map((command) => command.name), ...HAND_PORTED].sort();
}

function serializeLegacyIndex() {
  return `${listCliNames()
    .map((name) => `export * as ${resolveCamelName(name)} from './${name}';`)
    .join('\n')}\n`;
}

function serializeCommandIndex() {
  const names = listCliNames();
  return [
    ...names.map((name) => `import ${resolveCamelName(name)} from './${name}';`),
    "import type { CommandDefinition } from '../registry';",
    '',
    'export const COMMANDS: readonly CommandDefinition[] = [',
    ...names.map((name) => `  ${resolveCamelName(name)},`),
    '];',
    '',
  ].join('\n');
}

function serializeFlagHelp() {
  const entries = CLI_COMMANDS.flatMap((command) =>
    command.flags.map((flag) => [`${command.name}.${flag.name}`, flag.help] as const)
  );
  return `${JSON.stringify(Object.fromEntries(entries), null, 2)}\n`;
}

const CLI_PATHS = {
  registry: 'src/cli/registry.ts',
  suggest: 'src/cli/suggest.ts',
  help: 'src/cli/help.ts',
  index: 'src/cli/index.ts',
  commands: 'src/cli/commands/index.ts',
  push: 'src/cli/commands/push.ts',
  deploy: 'src/cli/commands/deploy.ts',
  codemod: 'scripts/codemods/define-command.ts',
  docs: 'scripts/generate-command-docs.ts',
  mcp: 'src/mcp/commands.ts',
  test: 'src/cli/help.test.ts',
};

function listCliFiles(serialize: (command: CliCommand) => string) {
  return Object.fromEntries(
    CLI_COMMANDS.map((command) => [`src/cli/commands/${command.name}.ts`, serialize(command)])
  );
}

function listCliBaseFiles(): Files {
  return {
    ...listCliFiles(serializeLegacyCommand),
    'src/cli/commands/deploy.ts': DEPLOY_BASE,
    'src/cli/commands/login.ts': LOGIN_BASE,
    'src/cli/commands/logs.ts': LOGS_BASE,
    'src/cli/commands/index.ts': serializeLegacyIndex(),
    'src/cli/parse-flags.ts': PARSE_FLAGS_BASE,
    [CLI_PATHS.index]: CLI_INDEX_BASE,
  };
}

function listCliNewFiles(): Files {
  return {
    ...listCliFiles(serializeCommand),
    [CLI_PATHS.deploy]: DEPLOY_NEW,
    'src/cli/commands/login.ts': LOGIN_NEW,
    'src/cli/commands/logs.ts': LOGS_NEW,
    [CLI_PATHS.commands]: COMMAND_INDEX_NEW,
    [CLI_PATHS.registry]: REGISTRY_NEW,
    [CLI_PATHS.suggest]: SUGGEST_NEW,
    [CLI_PATHS.help]: HELP_NEW,
    [CLI_PATHS.index]: CLI_INDEX_NEW,
    [CLI_PATHS.codemod]: CODEMOD_NEW,
    'scripts/codemods/flag-help.json': serializeFlagHelp(),
    [CLI_PATHS.docs]: DOCS_SCRIPT_NEW,
    [CLI_PATHS.mcp]: MCP_COMMANDS_NEW,
    [CLI_PATHS.test]: HELP_TEST_NEW,
  };
}

const PUSH_NEW = serializeCommand(CLI_COMMANDS[0] as CliCommand);

const COMMAND_INDEX_NEW = serializeCommandIndex();

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

const BUILT_STAGES = new Set<TaskStage>([
  'checking',
  'awaiting_review',
  'shipping',
  'awaiting_merge',
  'merged',
  'awaiting_operation',
]);

function resolveDefaultVerification(task: SeedTask, phases: number) {
  if (!(resolveSeedPipeline(task)?.includes('build') ?? true)) return [];
  if (task.verification) return task.verification;
  const area = task.branch.split('/').at(-1) ?? task.id;
  return [
    createPlanCheck(
      'Tests for the change',
      `bun test test/${area}`,
      Array.from({ length: phases }, (_, index) => index + 1)
    ),
  ];
}

function resolveSeedPlan(task: SeedTask): PlanDocument {
  if (task.plan) return task.plan;
  const phases = task.size === 'large' ? LARGE_PLAN : SMALL_PLAN;
  return {
    goal: task.request,
    phases,
    behaviour: [],
    approach: 'Planned by the agent.',
    files: [],
    outOfScope: [],
    verification: resolveDefaultVerification(task, phases.length),
    questions: [],
  };
}

function listTaskCheckResults(task: SeedTask) {
  const checks = [...resolveSeedPlan(task).verification, ...(task.addedChecks ?? [])];
  return listSeedCheckResults(checks, task.repo, task.checkResults);
}

function pushAddedChecks(task: SeedTask, phase: number, push: Push, clock: SeedClock) {
  const planned = resolveSeedPlan(task).verification.length;
  for (const [index, added] of (task.addedChecks ?? []).entries()) {
    if (added.phase !== phase) continue;
    push(clock.step(0.1), {
      type: 'checks.changed',
      taskId: task.id,
      runId: `${task.id}-run-${added.run}`,
      changes: [
        {
          action: 'add',
          check: {
            id: `c${planned + index + 1}`,
            label: added.label,
            command: added.command,
            phases: [...added.phases],
            source: 'agent',
          },
          reason: added.reason,
        },
      ],
    });
  }
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
    ...(task.forkOf ? { forkOf: task.forkOf } : {}),
    ...(task.createdBy ? { createdBy: task.createdBy } : {}),
    ...(task.watchHome ? { watchHome: true } : {}),
    ...(task.sourceReport ? { sourceReport: task.sourceReport } : {}),
    ...(task.sourceReport?.scheduleId ? { scheduleId: task.sourceReport.scheduleId } : {}),
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
      walkthrough:
        index === (progress.plan?.phases.length ?? 1) - 1 ? (task.report?.walkthrough ?? null) : null,
      at: 0,
    },
  });
  push(clock.step(0), { type: 'phase.updated', taskId: task.id, index, status: 'done' });
  pushAddedChecks(task, index + 1, push, clock);
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
  clock.step(run.afterMinutes ?? 0);
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

function resolveSeedPullRequest(task: SeedTask, at: number): PullRequest | null {
  if (!task.pullRequest) return null;
  const repository = task.repo.remote?.split(':').at(-1)?.replace('.git', '');
  return {
    number: task.pullRequest.number,
    url: `https://github.com/${repository}/pull/${task.pullRequest.number}`,
    state: task.merged ? 'merged' : 'open',
    checks: task.pullRequest.checks,
    unresolvedComments: task.pullRequest.comments ?? 0,
    mergeable: task.pullRequest.checks === 'passing',
    updatedAt: at,
    ...(task.pullRequest.mergeCommit ? { mergeCommit: task.pullRequest.mergeCommit } : {}),
    ...(task.pullRequest.changes ? { changes: task.pullRequest.changes } : {}),
  };
}

function pushTaskPullRequest(task: SeedTask, push: Push, clock: SeedClock) {
  const opened = resolveSeedPullRequest(task, clock.step(1));
  if (!opened) return;
  const runs = task.pullRequest?.ciRuns;
  if (!runs) {
    push(clock.at, { type: 'pull_request.opened', taskId: task.id, pullRequest: opened });
    return;
  }
  push(clock.at, {
    type: 'pull_request.opened',
    taskId: task.id,
    pullRequest: {
      ...opened,
      state: 'open',
      checks: 'pending',
      mergeable: false,
      checkRuns: runs.map((run) => ({ ...run, status: 'pending' as const })),
    },
  });
  push(clock.step(6), {
    type: 'pull_request.updated',
    taskId: task.id,
    pullRequest: { ...opened, updatedAt: clock.at, checkRuns: runs.map((run) => ({ ...run })) },
  });
}

function pushTaskResults(task: SeedTask, push: Push, clock: SeedClock) {
  const builds = resolveSeedPipeline(task)?.includes('build') ?? true;
  const results = listTaskCheckResults(task);
  if (builds && BUILT_STAGES.has(task.stage) && task.stage !== 'checking') {
    push(clock.step(0.3), { type: 'checks.recorded', taskId: task.id, results });
  }
  if (builds && (task.report || task.summary)) {
    push(clock.step(0.2), {
      type: 'work.submitted',
      taskId: task.id,
      summary: task.summary ?? task.report?.headline ?? '',
      report: task.report ? { ...task.report, checks: results } : null,
    });
  }
  if (task.findings) {
    push(clock.step(0.2), {
      type: 'review.reported',
      taskId: task.id,
      summary: task.reviewSummary ?? null,
      findings: task.findings,
      ...(task.reviewDisagreements ? { disagreements: task.reviewDisagreements } : {}),
    });
  }
  pushTaskPullRequest(task, push, clock);
}

function listSeedMergeSteps(task: SeedTask) {
  return task.report?.walkthrough?.steps ?? [];
}

function pushHandOverSteps(task: SeedTask, push: Push, clock: SeedClock) {
  const steps = listSeedMergeSteps(task);
  if (steps.length === 0) return;
  const pipeline = [...(resolveSeedPipeline(task) ?? SHAPE_PIPELINES.change)];
  const next = resolveHandOverPipeline(pipeline, {
    before: steps.some((step) => step.when === 'pre_merge'),
    after: steps.some((step) => step.when === 'post_merge'),
  });
  if (!isSamePipeline(next, pipeline)) {
    push(clock.step(0.05), {
      type: 'task.reshaped',
      taskId: task.id,
      pipeline: next,
      by: 'shinsa',
      reason: 'The work report lists steps for you around the merge.',
    });
  }
  for (const step of steps.filter((candidate) => task.ticked?.includes(candidate.title))) {
    push(clock.step(0.4), {
      type: 'merge_step.ticked',
      taskId: task.id,
      key: resolveMergeStepKey(step),
      title: step.title,
      done: true,
    });
  }
}

function resolvePostMergeGate(task: SeedTask): SeedTask['gate'] {
  const open = listSeedMergeSteps(task).filter(
    (step) => step.when === 'post_merge' && !task.ticked?.includes(step.title)
  );
  if (!task.merged || open.length === 0) return undefined;
  return {
    type: 'post_merge',
    title: `${open.length} ${open.length === 1 ? 'post-merge step' : 'post-merge steps'} left`,
    body: [
      `Pull request #${task.pullRequest?.number} merged. These steps are yours; tick each once you did it. The task is done once every step is ticked.`,
      '',
      ...open.map((step) => `- [ ] **${step.title}**: ${step.detail}`),
    ].join('\n'),
  };
}

function resolveSeedGateRun(task: SeedTask) {
  const runs = task.runs?.length ?? 0;
  if (!task.gate || isDecisionGate(task.gate) || runs === 0) return null;
  return `${task.id}-run-${runs - 1}`;
}

function pushTaskGate(task: SeedTask, push: Push, clock: SeedClock) {
  const seeded = task.gate ?? resolvePostMergeGate(task);
  if (!seeded) return;
  const gate: Gate = {
    id: `${task.id}-gate`,
    taskId: task.id,
    type: seeded.type,
    status: 'open',
    title: seeded.title,
    body: seeded.body,
    runId: resolveSeedGateRun(task),
    openedAt: clock.at,
    answeredAt: null,
    decision: null,
    response: null,
    ...seeded.details,
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
  pushHandOverSteps(task, push, clock);
  if (task.note) push(clock.step(0.1), { type: 'task.noted', taskId: task.id, note: task.note });
  for (const event of task.extra ?? []) push(clock.step(0.1), event);
  for (const { at, event } of task.timed ?? []) push(at, event);
  push(clock.step(0.1), { type: 'task.staged', taskId: task.id, stage: task.stage, reason: task.reason });
  pushTaskGate(task, push, clock);
}

function createSeedRule(
  at: number,
  id: string,
  text: string,
  overrides: Partial<MemoryEntry> = {}
): MemoryEntry {
  return {
    id,
    projectId: null,
    text,
    why: null,
    status: 'kept',
    taskId: null,
    runId: null,
    createdAt: at,
    updatedAt: at,
    ...overrides,
  };
}

function pushSeedMemory(start: number, push: (at: number, event: ShinsaEventInput) => void) {
  const kept = [
    createSeedRule(start, 'memory-dashes', 'Never use em dashes in UI copy or messages.'),
    createSeedRule(start + 1, 'memory-terse', 'Keep hand-overs short: lead with the result, no recap.'),
    createSeedRule(start + 2, 'memory-swift', 'Keep the Swift SDK’s public API source compatible.', {
      projectId: 'project-basket',
    }),
  ];
  for (const entry of kept) push(entry.createdAt, { type: 'memory.written', entry });
  const proposal = createSeedRule(NOW - 2 * HOUR, 'memory-plans', 'Keep plans to three phases or fewer.', {
    status: 'proposed',
    projectId: 'project-basket',
    why: 'You asked for a shorter plan twice on the checkout redesign.',
  });
  push(proposal.createdAt, { type: 'memory.proposed', entry: proposal });
}

function createSeedFeedback(at: number, id: string, overrides: Partial<Feedback>): Feedback {
  return {
    id,
    source: 'human',
    note: '',
    title: null,
    body: null,
    status: 'draft',
    failure: null,
    issue: null,
    taskId: null,
    runId: null,
    createdAt: at,
    updatedAt: at,
    ...overrides,
  };
}

const SEED_ENVIRONMENT = [
  '- Shinsa: 0.42.0 (3f9c2e1), the Mac app',
  '- System: macOS (Darwin 25.1.0), arm64',
  '- Runtime: Bun 1.3.4',
  '- Default agent: claude, claude-opus-5-5',
];

function serializeSeedIssue(sections: [string, string[]][], environment: string[]) {
  return [
    ...sections.flatMap(([heading, lines]) => [`### ${heading}`, '', ...lines, '']),
    '### Environment',
    '',
    ...SEED_ENVIRONMENT,
    ...environment,
  ].join('\n');
}

function pushSeedFeedback(push: (at: number, event: ShinsaEventInput) => void) {
  const entries = [
    createSeedFeedback(NOW - 3 * DAY, 'feedback-filed', {
      note: 'The usage menu should say when my limit resets, not only how much is left.',
      title: 'Show when a usage limit resets in the usage menu',
      body: serializeSeedIssue(
        [
          [
            'Summary',
            ['The usage menu shows how much of each usage limit is used, but never when the limit resets.'],
          ],
          [
            'Where in Shinsa',
            [
              'The usage menu in the header, opened from the usage meter, with a task paused on a usage limit.',
            ],
          ],
          [
            'What happened',
            [
              'The menu lists each account’s limits as percentages. A task paused on a usage limit says it waits for the reset, and nothing on screen says when that is.',
            ],
          ],
          [
            'What should happen',
            [
              'Each limit shows its reset time beside the percentage, such as “Resets at 14:00”, in the local time zone.',
            ],
          ],
          [
            'Steps to reproduce',
            [
              '1. Use an account until one of its limits is nearly used up.',
              '2. Open the usage menu in the header.',
              '3. Look for when the limit resets: only the percentage is shown.',
            ],
          ],
          [
            'Why it matters',
            [
              'Without the reset time it is unclear whether to switch accounts or wait, so paused tasks sit longer than they need to.',
            ],
          ],
          [
            'Suggested change',
            [
              'Show the reset time each provider reports with its usage, in each limit’s row of the usage menu.',
            ],
          ],
          [
            'Acceptance criteria',
            [
              '- [ ] Every limit in the usage menu shows when it resets.',
              '- [ ] The time is in the local time zone.',
              '- [ ] A limit whose provider reports no reset time shows no time rather than a wrong one.',
            ],
          ],
        ],
        ['- Sent by: the person using Shinsa']
      ),
      status: 'filed',
      issue: {
        number: 214,
        url: 'https://github.com/shinsa-dev/shinsa/issues/214',
        openedAt: NOW - 3 * DAY,
        closedAt: null,
      },
    }),
    createSeedFeedback(NOW - 6 * DAY, 'feedback-closed', {
      source: 'agent',
      note: 'report_review refused my findings because one file path had a leading ./ before it.',
      title: 'Review hand-over refuses a finding whose file path starts with ./',
      body: serializeSeedIssue(
        [
          [
            'Summary',
            [
              '`report_review` refuses the whole review when a finding names its file as `./path` instead of `path`.',
            ],
          ],
          [
            'Where in Shinsa',
            ['The agent review step, when the reviewer hands over findings with `report_review`.'],
          ],
          [
            'What happened',
            [
              'The tool answered that the finding’s file is not in the change, though it is, and the reviewer had to send every finding again.',
            ],
          ],
          ['What should happen', ['A leading `./` is read as the same path, and the review is accepted.']],
          [
            'Steps to reproduce',
            [
              '1. Open a task at its agent review.',
              '2. Have the reviewer call `report_review` with a finding whose file starts with `./`.',
            ],
          ],
          ['Why it matters', ['A review is sent twice, and its findings reach the human later.']],
          ['Suggested change', ['Normalize finding paths before checking them against the change.']],
          [
            'Acceptance criteria',
            [
              '- [ ] A finding whose file starts with `./` is accepted.',
              '- [ ] A file outside the change is still refused.',
            ],
          ],
        ],
        ['- Sent by: an agent working in Shinsa', '- Step: agent review, as the reviewer']
      ),
      status: 'filed',
      issue: {
        number: 198,
        url: 'https://github.com/shinsa-dev/shinsa/issues/198',
        openedAt: NOW - 6 * DAY,
        closedAt: NOW - 2 * DAY,
      },
    }),
    createSeedFeedback(NOW - 50 * MINUTE, 'feedback-agent', {
      source: 'agent',
      taskId: 'task-basket-sync',
      note: 'complete_phase refused my spots because one range ended past the last line of a file I had just shortened.',
      title: 'Phase hand-over refuses a spot on a file shortened in the same phase',
      body: serializeSeedIssue(
        [
          [
            'Summary',
            [
              '`complete_phase` refuses the whole hand-over when one spot’s range ends past the end of a file the phase shortened.',
            ],
          ],
          ['Where in Shinsa', ['The `complete_phase` agent tool, during a build phase of a change task.']],
          [
            'What happened',
            [
              'The agent shortened a file, then handed the phase over with a spot whose line range it had read before the edit. The range ended past the file’s new last line, and Shinsa refused the hand-over with a generic range error that named neither the spot nor the file’s length.',
            ],
          ],
          [
            'What should happen',
            [
              'The refusal names the spot, the file and its current line count, so the agent can fix that one range.',
            ],
          ],
          [
            'Steps to reproduce',
            [
              '1. In a build phase, have the agent remove lines from the end of a file.',
              '2. Call `complete_phase` with a spot on that file whose `end` is the old last line.',
              '3. The hand-over is refused with a generic error.',
            ],
          ],
          [
            'Why it matters',
            ['The agent has to guess which spot is wrong and retry, which costs a turn per guess.'],
          ],
          [
            'Suggested change',
            ['Have the spot validation report the spot’s index, its file and the file’s current length.'],
          ],
          [
            'Acceptance criteria',
            [
              '- [ ] A spot past the end of its file is refused with its index, file and the file’s line count.',
              '- [ ] The other spots in the hand-over are not reported.',
            ],
          ],
        ],
        [
          '- Sent by: an agent working in Shinsa',
          '- Kind of task: change',
          '- Stage of the task: building',
          '- Agent role: agent, working on its build step',
          '- Agent provider and model: claude, claude-opus-5-5',
        ]
      ),
    }),
    createSeedFeedback(NOW - 12 * MINUTE, 'feedback-draft', {
      note: 'I wish I could drag a task in the queue to change its priority.',
      title: 'Change a task’s priority by dragging it in the queue',
      body: serializeSeedIssue(
        [
          [
            'Summary',
            ['Changing a task’s priority takes a menu per task; dragging it in the queue would be quicker.'],
          ],
          [
            'Where in Shinsa',
            ['The queue, in its popover from the header and on Home, with several tasks waiting.'],
          ],
          [
            'What happened',
            [
              'Changing a priority takes the row’s menu: open it, pick a priority, then find the task again in the reordered queue.',
            ],
          ],
          [
            'What should happen',
            [
              'Dragging a row up or down raises or lowers its priority, and the row stays under the pointer while it moves.',
            ],
          ],
          ['Steps to reproduce', ['Not given in the feedback.']],
          ['Why it matters', ['With several tasks waiting, putting them in order takes one menu per task.']],
          [
            'Suggested change',
            [
              'Let a queue row be dragged between rows of another priority, and set its priority to theirs when it is dropped.',
            ],
          ],
          [
            'Acceptance criteria',
            [
              '- [ ] A row dropped among rows of another priority takes that priority.',
              '- [ ] The row stays under the pointer while it is dragged.',
              '- [ ] The row’s menu still changes the priority as before.',
            ],
          ],
        ],
        ['- Sent by: the person using Shinsa']
      ),
    }),
  ];
  for (const entry of entries) push(entry.createdAt, { type: 'feedback.recorded', entry });
}

function buildEvents(tasks: SeedTask[], projects: Project[], repos: Repo[]) {
  const timeline: Timeline = [];
  const push = (at: number, event: ShinsaEventInput) => timeline.push({ at, event });
  const start = NOW - 10 * DAY;
  for (const project of projects) push(start, { type: 'project.written', project });
  for (const repo of repos) push(start, { type: 'repo.registered', repo });
  pushSeedMemory(start, push);

  push(start, { type: 'settings.changed', settings: { ...createSettings(), taskUsageLimit: 10 } });
  for (const task of tasks) pushTask(task, push);
  pushSeedFeedback(push);
  const runEnds = new Map(
    timeline.flatMap(({ at, event }) => (event.type === 'run.ended' ? [[event.runId, at] as const] : []))
  );
  for (const { at, event } of listSeedEvidenceEvents(runEnds)) push(at, event);
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
  const homes = new Set<string>();
  return timeline.map(({ at, event }) => {
    if (event.type === 'task.created' && event.watchHome) homes.add(event.taskId);
    if (homes.has('taskId' in event ? String(event.taskId) : '')) return { at, event };
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

function listSeedDisagreements(task: SeedTask) {
  const calls = task.report?.judgementCalls ?? [];
  return (task.reviewDisagreements ?? []).map((entry) => ({
    call: calls.findIndex((call) => call.call === entry.call) + 1,
    reason: entry.reason,
  }));
}

function resolveHandover({ task, role, purpose, index }: SeedRunTimes): ChatTool {
  const seeded = task.runs?.[index]?.handover;
  if (seeded) return seeded;
  const body = task.summary ?? task.title;
  if (purpose === 'plan') {
    return { kind: 'shinsa', name: 'propose_plan', args: { goal: task.request, phases: SMALL_PLAN } };
  }
  if (purpose === 'build') return { kind: 'shinsa', name: 'complete_phase', args: { summary: body } };
  if (purpose === 'operate') return { kind: 'shinsa', name: 'report_outcome', args: { outcome: body } };
  if (role === 'reviewer') {
    const summary = task.reviewSummary ? { summary: task.reviewSummary } : {};
    return {
      kind: 'shinsa',
      name: 'report_review',
      args: { ...summary, findings: task.findings ?? [], disagreements: listSeedDisagreements(task) },
    };
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
  verification: [
    createPlanCheck('Webhook writes the tier', 'bun test test/billing/webhook.test.ts', [2, 3]),
    createPlanCheck('Shared-list limit per tier', 'bun test test/lists/limit.test.ts', [3]),
  ],
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
    checkCommands: ['bun lint', 'bun check-types'],
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
    ...EXPORT_FILES_BASE,
    ...listCliBaseFiles(),
    'package.json': '{ "name": "paywall-next", "private": true }\n',
  };
  const paywallPath = createRepo('superwall/paywall-next', paywallBase);
  const kannaPath = createRepo('kanna', {
    'src/shared/defaults.ts': DEFAULTS_BASE,
    'src/client/theme.css': KANNA_THEME,
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
  exportBackoff: string;
  registry: string;
}

function createWorktrees({ paywall, kanna }: SeedRepos): SeedWorktrees {
  const paywallPath = paywall.path;
  const kannaPath = kanna.path;
  const chatPath = createWorktree(paywallPath, 'task-embedded-chat', 'feat/embedded-chat-mcp', 'main', {
    'src/chat/embedded-chat.ts': EMBEDDED_CHAT_NEW,
    'src/chat/mcp-session.ts': MCP_SESSION_NEW,
    'src/chat/mcp-session.test.ts': MCP_SESSION_TEST_NEW,
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
    'src/ui/tab-group.test.tsx': TAB_GROUP_TEST_NEW,
  });
  commitWorktree(tabsPath, 'fix(ui): scroll tab groups horizontally');
  const exportBackoffPath = createWorktree(
    paywallPath,
    'task-export-backoff',
    'fix/export-retry-restart',
    'main',
    EXPORT_FILES_NEW
  );
  commitWorktree(exportBackoffPath, 'fix(export): resume retries inside the chunk and after a restart');
  const registryPath = createWorktree(
    paywallPath,
    'task-command-registry',
    'refactor/command-registry',
    'main',
    listCliNewFiles()
  );
  commitWorktree(registryPath, 'refactor(cli): declare every command with defineCommand');
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
    'src/shared/defaults.test.ts': DEFAULTS_TEST_NEW,
  });
  commitWorktree(defaultsPath, 'feat(models): fall back to a cheaper model near the usage limit');
  return {
    chat: chatPath,
    duplicate: duplicatePath,
    tabs: tabsPath,
    rounds: roundsPath,
    defaults: defaultsPath,
    exportBackoff: exportBackoffPath,
    registry: registryPath,
  };
}

const RECONNECT_CALL = 'Reconnect limit of 3';

function listEmbeddedChatTasks({ paywall }: SeedRepos, worktrees: SeedWorktrees): SeedTask[] {
  const chatPath = worktrees.chat;
  const chatFile = 'src/chat/embedded-chat.ts';
  const sessionFile = 'src/chat/mcp-session.ts';
  const testFile = 'src/chat/mcp-session.test.ts';
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
      waitsOn: ['task-webhook-signing', 'task-docs-gate'],
      worktreePath: chatPath,
      addedChecks: [
        {
          label: 'Tool result rows',
          command: 'bun test src/chat/embedded-chat.test.ts',
          phases: [3, 4],
          phase: 3,
          run: 1,
          reason: 'Phase 3 renders tool results in embedded-chat.ts, which no check of the plan covered.',
        },
      ],
      checkResults: {
        c1: { detail: '6 tests, 3 new' },
        c3: { detail: '4 tests, all new' },
      },
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
          createPlanCheck('Session reconnect limit', 'bun test src/chat/mcp-session.test.ts', [1, 4]),
          createPlanCheck('Lint the chat module', 'bunx biome check src/chat', [1, 2, 3, 4]),
        ],
        questions: [],
      },
      report: {
        headline: 'The embedded chat now runs on an MCP v2 session and renders tool results inline.',
        sections: [
          {
            title: 'Open an MCP session per chat',
            summary:
              'A new McpSession owns the SDK client, connects on the first message and gives up after three failed attempts.',
            spots: [
              spot(sessionFile, MCP_SESSION_NEW, 'if (this.client) return;', 'this.attempts += 1;', 'high', {
                title: 'Connect on first use, at most three times',
                why: 'A connected session returns at once, so a client whose transport has closed is never replaced.',
                explain:
                  '`ensureConnected` is called before every send. A live `client` returns straight away. Otherwise it checks the attempt counter against `RECONNECT_LIMIT` and counts this attempt before connecting, so a failed connect still uses one up.',
              }),
              spot(
                sessionFile,
                MCP_SESSION_NEW,
                'const client = new Client({',
                'this.attempts = 0;',
                'critical',
                {
                  title: 'A good connect resets the counter',
                  why: 'The reconnect counter only resets on success. A server that drops after connecting gets three new tries each time, not three in total.',
                  explain:
                    'The SDK `Client` is built per attempt and only stored once `connect` resolves. Setting `attempts` back to 0 here makes the limit count failures in a row rather than failures over the life of the chat.',
                }
              ),
              spot(
                sessionFile,
                MCP_SESSION_NEW,
                'const transport = new StreamableHTTPClientTransport',
                "requestInit: { headers: { 'x-paywall-id'",
                'high',
                {
                  title: 'The paywall travels as a header',
                  why: 'The paywall id travels as a header; the MCP server must accept it on every request, not just initialize.',
                  explain:
                    '`requestInit` is applied to every HTTP request the streamable transport makes, so the server sees `x-paywall-id` on the initialize call and on each tool call. The same `signal` aborts the connect when the editor closes the chat.',
                }
              ),
            ],
          },
          {
            title: 'Route messages through the session',
            summary:
              'send() connects if needed and walks the parts of one chat.complete call, recording each as its own message. reset() now closes the session.',
            spots: [
              spot(
                chatFile,
                EMBEDDED_CHAT_NEW,
                'const stream = this.session.complete',
                "this.record({ id: part.id, role: 'assistant'",
                'high',
                {
                  title: 'Every part becomes a row',
                  why: 'Each streamed part becomes its own message. Long replies will arrive as many rows unless the server sends one text part.',
                  explain:
                    '`send` iterates the generator with `for await`. Tool results go through `describeTool`, text parts become assistant messages, and both pass through `record`, which appends to `history` and calls `onMessage` so the editor renders them in order.',
                }
              ),
              spot(chatFile, EMBEDDED_CHAT_NEW, 'async reset()', 'await this.session.close();', 'normal', {
                title: 'Reset closes the connection',
                why: 'reset() changed from sync to async. Two call sites in the editor await it now.',
                explain:
                  'Clearing the history alone would leave an open MCP connection per reset. `close()` shuts the SDK client and drops it, so the next `send` connects again with a fresh session.',
              }),
            ],
          },
          {
            title: 'Render tool results inline',
            summary:
              'The session splits the tool response into text and tool_result parts; the chat turns tool results into rows with role tool.',
            spots: [
              spot(
                sessionFile,
                MCP_SESSION_NEW,
                'for (const item of response.content',
                "yield { kind: 'text', id: crypto.randomUUID()",
                'high',
                {
                  title: 'Split the response into parts',
                  why: '`isError` is always false here, so a failed tool is never labelled as failed.',
                  explain:
                    '`chat.complete` returns one `content` array. Items of type `tool_result` become tool parts with their name and text; everything else is treated as text and gets a fresh id so the editor can key the rows.',
                }
              ),
              spot(chatFile, EMBEDDED_CHAT_NEW, 'private describeTool', 'toolName: result.name,', 'normal', {
                title: 'Tool rows carry the tool name',
                why: 'Failed tools are shown to the user with the raw error text.',
                explain:
                  'A tool result becomes a message with role `tool` and the tool’s name, which the transcript uses for the row label. A failed result is prefixed with the tool name and “failed:”.',
              }),
            ],
          },
          {
            title: 'Test the session',
            summary: 'Three new tests run the session against a fake MCP server.',
            spots: [
              spot(
                testFile,
                MCP_SESSION_TEST_NEW,
                "it('gives up after three failed connects'",
                "rejects.toThrow('The MCP server is unreachable.')",
                'high',
                {
                  title: 'Three refused connects, then the error',
                  why: 'Only refused connects are tested. A server that accepts and then drops, the case that matters, is not.',
                  explain:
                    'The fake server refuses every connect. Three calls fail with the transport error and the fourth fails with the unreachable message without touching the network, which is what the user sees in the chat.',
                }
              ),
            ],
          },
        ],
        judgementCalls: [
          {
            title: 'Keep the EmbeddedChat API',
            call: 'Kept the public EmbeddedChat API',
            reason: 'Only the constructor option was renamed, so the editor change stays small.',
            file: chatFile,
            ...rangeOf(EMBEDDED_CHAT_NEW, 'export interface EmbeddedChatOptions', 'signal?: AbortSignal;'),
            alternatives: [
              {
                option: 'Hand the McpSession to the editor',
                rejected:
                  'Every editor screen that embeds the chat would learn about MCP, connects and tool parts.',
              },
              {
                option: 'Add an EmbeddedChatV2 next to the old class',
                rejected:
                  'Two chats to keep in step until the old endpoint is switched off, and nothing else uses the old one.',
              },
            ],
          },
          {
            title: 'Reconnect at most three times',
            call: RECONNECT_CALL,
            reason:
              'Matches the editor’s other network retries; past that the user sees an error instead of a spinner.',
            file: sessionFile,
            ...rangeOf(MCP_SESSION_NEW, 'const RECONNECT_LIMIT = 3;', 'const RECONNECT_LIMIT = 3;'),
            alternatives: [
              {
                option: 'Exponential backoff up to a 30 second deadline',
                rejected: 'The user watches a spinner for half a minute before learning the server is down.',
              },
              {
                option: 'Keep retrying in the background',
                rejected:
                  'The chat looks alive while every message fails, and nothing tells the user to reload.',
              },
            ],
          },
          {
            title: 'chat.complete as an MCP tool',
            call: 'Called chat.complete as an MCP tool instead of using sampling',
            reason:
              'The paywall server owns the model and the paywall tools, so the chat asks it through one tool call. Sampling would run the model on our side.',
            file: sessionFile,
            ...rangeOf(
              MCP_SESSION_NEW,
              'const response = await this.client.callTool(',
              '{ signal: options.signal }'
            ),
            alternatives: [
              {
                option: 'MCP sampling with sampling/createMessage',
                rejected:
                  'Sampling is the server asking the client for a completion; here the server has the model and the tools.',
              },
            ],
          },
          {
            title: 'Keep complete() a generator',
            call: 'Kept complete() a generator although the reply arrives whole',
            reason:
              'The server sends the whole response today. When it starts sending progress notifications, only McpSession changes and send() stays as it is.',
            file: sessionFile,
            ...rangeOf(MCP_SESSION_NEW, 'async *complete(', 'async *complete('),
            alternatives: [
              {
                option: 'Return an array of parts',
                rejected: 'Simpler now, but send() would change again once the server streams.',
              },
            ],
          },
        ],
        walkthrough: {
          approach:
            'The old chat posted the whole history to `/chat` and waited for one reply. This change puts an `McpSession` between the chat and the paywall server: it owns the official SDK `Client`, connects on the first message, and turns one `chat.complete` tool call into a list of parts.\n\n`EmbeddedChat` keeps its shape. `send()` still takes text and reports messages through `onMessage`; it now walks the parts and records text and tool results as separate rows. Only the constructor option changed, from `endpoint` to `serverUrl`, and `reset()` became async because it closes the connection.\n\n`transport.ts` is deleted: the chat was its only caller.',
          flow: '1. The editor calls `send(text)`. The user message goes into `history` first.\n2. `ensureConnected` returns at once when a client exists. Otherwise it counts an attempt and connects over streamable HTTP with `x-paywall-id` on every request. After three failures in a row it throws “The MCP server is unreachable.”\n3. `complete` calls the `chat.complete` tool with the history and the paywall id.\n4. The response’s `content` items become parts: `tool_result` items as tool parts, the rest as text.\n5. `send` records each part through `record`, which appends it to `history` and hands it to `onMessage`.\n6. `reset()` clears the history and closes the client.\n\n```text\neditor\n  │ send(text)\n  ▼\nEmbeddedChat ──────────────── history.push(user message)\n  │\n  ▼\nMcpSession.ensureConnected ── first call: Client.connect,\n  │                            streamable HTTP, x-paywall-id\n  ▼\nMcpSession.complete ──callTool(chat.complete)──▶ MCP server\n  │                                                  │\n  │ ◀──────────── content[]: text, tool_result ──────┘\n  ▼\nparts ──▶ record() ──▶ history + onMessage ──▶ transcript rows\n```\n\nThe history sent to the server includes the tool rows, so the model sees what its tools returned on the next turn.',
          risks: [
            {
              title: 'Orphaned user turn on a failed connect',
              risk: 'The user message is pushed before connecting. If the connect fails or the signal aborts, the history keeps a user turn with no reply and the next send carries it along.',
              file: chatFile,
              ...rangeOf(
                EMBEDDED_CHAT_NEW,
                'this.history.push(message);',
                'await this.session.ensureConnected'
              ),
            },
            {
              title: 'Replies arrive whole',
              risk: 'Nothing streams yet: `callTool` resolves with the whole response before the first part is yielded, so a long reply still shows nothing until it is complete.',
              file: sessionFile,
              ...rangeOf(
                MCP_SESSION_NEW,
                'const response = await this.client.callTool(',
                '{ signal: options.signal }'
              ),
            },
            {
              title: 'Paywall id read on every request',
              risk: 'The paywall server has to read `x-paywall-id` on every request. If it only checks it on initialize, tool calls run against no paywall.',
              file: sessionFile,
              ...rangeOf(
                MCP_SESSION_NEW,
                "requestInit: { headers: { 'x-paywall-id'",
                "requestInit: { headers: { 'x-paywall-id'"
              ),
            },
          ],
          testing: {
            automated: [
              '`mcp-session.test.ts` runs the session against a fake MCP server: three refused connects then the unreachable error, `x-paywall-id` on every request, and tool results arriving as their own parts.',
            ],
            manual: [
              {
                action: 'Start the editor and the local MCP server from the worktree.',
                target: { kind: 'command', value: 'PAYWALL_MCP_URL=http://localhost:7410/mcp bun dev' },
                expect: 'The editor serves on port 5173 and the chat panel opens without a connection error.',
              },
              {
                action: 'Open a paywall and ask the chat to change the headline to “Spring sale”.',
                target: { kind: 'url', value: 'http://localhost:5173/paywalls/spring-sale' },
                expect:
                  'A tool row with `paywall.update` appears under the reply and the preview shows the new headline.',
              },
              {
                action: 'Stop the MCP server mid-conversation and send another message.',
                target: null,
                expect: 'After three failed tries the chat shows the unreachable error instead of a spinner.',
              },
              {
                action: 'Reset the chat while a reply is still streaming, then send a new message.',
                target: null,
                expect: 'The next conversation starts empty, with no half reply from the old one.',
              },
              {
                action: 'Check that the paywall id rides on every request, not only on initialize.',
                target: {
                  kind: 'file',
                  value: `${sessionFile}:${lineOf(MCP_SESSION_NEW, "requestInit: { headers: { 'x-paywall-id'")}`,
                },
                expect: 'The header is set on the transport, so every tool call carries `x-paywall-id`.',
              },
            ],
          },
          steps: [
            {
              when: 'pre_merge',
              kind: 'env',
              title: 'Set `PAYWALL_MCP_URL` for the editor in production',
              detail:
                'The editor builds `serverUrl` from it and has no default. Use the MCP v2 endpoint, `https://mcp.superwall.com/v2`; staging already has it. `.env.example` names it.',
              command: 'vercel env add PAYWALL_MCP_URL production',
            },
            {
              when: 'post_merge',
              kind: 'config',
              title: 'Turn on `embedded-chat-mcp-v2` for 10% of workspaces',
              detail:
                'In LaunchDarkly, production. Raise it to everyone once the chat’s error rate holds for a day.',
              command: null,
            },
          ],
        },
      },
      reviewSummary:
        'I read the new MCP session, the rewired chat and the three new tests, and ran a chat against a server that drops after connecting. The tool rows work; the reconnect limit does not hold, so a flaky server keeps the chat retrying forever, and failed tools are never labelled.',
      reviewDisagreements: [
        {
          call: RECONNECT_CALL,
          reason:
            'Three is a fine number, but it is not enforced: the counter resets after every good connect, so a server that accepts and then drops is retried forever. Count per session, and test a server that drops, not only one that refuses.',
        },
      ],
      findings: [
        {
          severity: 'blocking',
          file: sessionFile,
          line: lineOf(MCP_SESSION_NEW, 'async ensureConnected('),
          end: lineOf(MCP_SESSION_NEW, 'this.attempts = 0;'),
          title: 'The reconnect limit resets on every connect',
          message:
            'ensureConnected sets attempts back to 0 after each successful connect. A server that accepts and then drops gets three new tries every time, so the chat never shows the unreachable error the plan promises.',
          fix: 'Count attempts for the whole session: remove `this.attempts = 0;` from ensureConnected and reset it in `close()` instead.\n\n```ts\nasync close() {\n  await this.client?.close();\n  this.client = null;\n  this.attempts = 0;\n}\n```',
        },
        {
          severity: 'should_fix',
          file: sessionFile,
          line: lineOf(MCP_SESSION_NEW, 'const client = new Client({'),
          end: lineOf(MCP_SESSION_NEW, 'this.client = client;'),
          title: 'A dropped connection is never noticed',
          message:
            'this.client stays set after the transport closes, so ensureConnected returns early and the next complete() call fails on a dead client instead of reconnecting.',
          fix: 'Clear the client when the connection closes:\n\n```ts\nclient.onclose = () => {\n  this.client = null;\n};\n```',
        },
        {
          severity: 'should_fix',
          file: sessionFile,
          line: lineOf(MCP_SESSION_NEW, "if (item.type === 'tool_result')"),
          end: lineOf(MCP_SESSION_NEW, 'isError: false'),
          title: 'Failed tools are never labelled',
          message:
            'complete() sets `isError: false` on every tool result, so describeTool never takes its failed branch and a failed paywall.update reads like a success. The plan promises failures are labelled.',
          fix: 'Pass the flag through from the response item:\n\n```ts\nisError: item.isError === true,\n```\n\nand add `isError?: boolean` to the item type.',
        },
        {
          severity: 'should_fix',
          file: chatFile,
          line: lineOf(EMBEDDED_CHAT_NEW, 'async reset()'),
          end: lineOf(EMBEDDED_CHAT_NEW, 'await this.session.close();'),
          title: 'reset() clears the history before the session closes',
          message:
            'A reply still streaming when reset() runs is recorded into the new, empty history, so the next conversation starts with a stray assistant message.',
          fix: 'Close the session first, then clear the history.',
        },
      ],
      runs: [
        { role: 'agent', purpose: 'plan', minutes: 6, summary: 'Proposed the MCP session plan.' },
        { role: 'agent', purpose: 'build', minutes: 34, summary: 'Built the session and rewired the chat.' },
        {
          role: 'reviewer',
          minutes: 4,
          summary: 'One blocking finding on the reconnect limit, three suggestions.',
          reply:
            'One blocking finding: the reconnect counter in [mcp-session.ts](shinsa://file/src/chat/mcp-session.ts#L26) resets after every successful connect, so a flaky server gets three new tries every time, and I disagree with the reconnect limit decision for the same reason. Three suggestions, on dropped connections, unlabelled tool failures and reset().\n\n[Let the embedded chat call paywall tools](shinsa://task/task-chat-tools) waits on this change, and #4531 from "Refuse to duplicate code-first paywalls" touches the same editor, so merging that first keeps the conflicts small. The work is on [feat/embedded-chat-mcp](shinsa://branch/feat/embedded-chat-mcp) in [paywall-next](shinsa://repo/paywall-next).',
        },
      ],
      extra: listEmbeddedChatIterations(),
      gate: {
        type: 'review',
        title: 'Review the embedded chat on MCP v2',
        body: 'Built, checked and reviewed by an agent. One blocking finding and three suggestions left for you to judge.',
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

const EXIT_CODE_CALL = 'Usage errors exit with code 2';

function listReviewTasks({ paywall }: SeedRepos, worktrees: SeedWorktrees): SeedTask[] {
  const duplicatePath = worktrees.duplicate;
  const tabsPath = worktrees.tabs;
  const duplicateFile = 'src/paywalls/duplicate.ts';
  const duplicateTestFile = 'src/paywalls/duplicate.test.ts';
  const errorsFile = 'src/paywalls/errors.ts';
  const tabsFile = 'src/ui/tab-group.tsx';
  const tabsTestFile = 'src/ui/tab-group.test.tsx';
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
            title: 'Find the duplicate path',
            summary:
              'The dashboard button and the public API both call duplicatePaywall, which copied any paywall, code-first ones included.',
            spots: [],
          },
          {
            title: 'Refuse code-first paywalls',
            summary:
              'duplicatePaywall throws a typed error for code-first paywalls, with its own error code.',
            spots: [
              spot(
                duplicateFile,
                DUPLICATE_NEW,
                'const source = await db.paywall.findUniqueOrThrow',
                'throw new PaywallError',
                'high',
                {
                  title: 'Refuse after reading the source',
                  why: 'The API maps PaywallError codes to 409; the dashboard shows the message as is.',
                  explain:
                    'The source paywall is read as before; when its `kind` is `code_first` the function throws before anything is written. Visual paywalls take the old path unchanged.',
                }
              ),
              spot(
                errorsFile,
                ERRORS_NEW,
                'export type PaywallErrorCode',
                'export class PaywallError',
                'normal',
                {
                  title: 'A code for this refusal',
                  why: 'Clients that switch on the code need a case for the new value, or they fall into their default.',
                  explain:
                    '`code_first_duplicate` joins the union, so the API layer maps it like the other codes and the dashboard can show the message instead of a generic failure.',
                }
              ),
            ],
          },
          {
            title: 'Cover both kinds with tests',
            summary: 'One test per paywall kind.',
            spots: [
              spot(
                duplicateTestFile,
                DUPLICATE_TEST_NEW,
                "it('refuses a code-first paywall'",
                'rejects.toThrow',
                'normal',
                {
                  title: 'The refusal',
                  why: 'Fails on main, passes on this branch.',
                  explain:
                    'Seeds a code-first paywall and expects the duplicate to reject with the repository message, so a regression shows up as a test failure rather than a copied paywall.',
                }
              ),
              spot(
                duplicateTestFile,
                DUPLICATE_TEST_NEW,
                "it('copies a visual paywall'",
                'expect(copy.name)',
                'normal',
                {
                  title: 'Visual paywalls still copy',
                  why: 'Only the name is checked, not the copied content.',
                  explain:
                    'The happy path stays covered: a visual paywall is copied for a new owner and gets the “(copy)” suffix.',
                }
              ),
            ],
          },
        ],
        judgementCalls: [
          {
            title: 'Guard the server, not the button',
            call: 'Guarded duplicatePaywall instead of hiding the button',
            reason:
              'The dashboard, the public API and the template job all call it. One guard in the function covers every caller.',
            file: duplicateFile,
            ...rangeOf(DUPLICATE_NEW, "if (source.kind === 'code_first')", 'throw new PaywallError'),
            alternatives: [
              {
                option: 'Hide the Duplicate button for code-first paywalls',
                rejected:
                  'The API route stays open, and the next client with a duplicate action repeats the bug.',
              },
              {
                option: 'Check the kind in each route handler',
                rejected: 'Three callers would each need the same check, and a fourth would forget it.',
              },
            ],
          },
          {
            title: 'A dedicated error code',
            call: 'Added a code_first_duplicate error code',
            reason:
              'The dashboard shows PaywallError messages as they are. `forbidden` would tell the user they lack access, which is not why it failed.',
            file: errorsFile,
            ...rangeOf(ERRORS_NEW, 'export type PaywallErrorCode', 'export type PaywallErrorCode'),
            alternatives: [
              {
                option: 'Reuse forbidden',
                rejected: 'Reads as a permissions problem, and support would chase the wrong cause.',
              },
              {
                option: 'Throw a plain Error',
                rejected: 'Becomes a 500 and an alert for a request that is simply not allowed.',
              },
            ],
          },
          {
            title: 'Check the kind after the read',
            call: 'Checked the kind after the read instead of filtering in the query',
            reason:
              'Filtering in `where` would turn a code-first paywall into not found, which hides the reason.',
            file: duplicateFile,
            ...rangeOf(
              DUPLICATE_NEW,
              'const source = await db.paywall.findUniqueOrThrow',
              "if (source.kind === 'code_first')"
            ),
            alternatives: [
              {
                option: "Add `kind: { not: 'code_first' }` to the query",
                rejected:
                  'One query instead of a check, but the user would see “not found” for a paywall they are looking at.',
              },
            ],
          },
        ],
        walkthrough: {
          approach:
            'Code-first paywalls live in a repository; the dashboard only mirrors them. Duplicating one created a dashboard copy that no repository owns, which then drifted from the code.\n\nThe fix is one guard where every duplicate starts: `duplicatePaywall` reads the source, and a code-first source throws a `PaywallError` with a new `code_first_duplicate` code and a message that says where to duplicate it instead.',
          flow: "1. The dashboard or the API calls `duplicatePaywall(paywallId, ownerId)`.\n2. The source paywall is read; a missing one still throws not found.\n3. A `code_first` source throws `PaywallError('code_first_duplicate')`.\n4. The API maps the code to 409 and returns the message; the dashboard shows it in a toast.\n5. A visual paywall is copied as before.\n\n```text\nDuplicate button ─┐\nPOST /duplicate ──┼──▶ duplicatePaywall(paywallId, ownerId)\ntemplate job ─────┘          │\n                             ▼\n                       read the source ── missing ──▶ not found\n                             │\n                             ▼\n                       code_first? ── yes ──▶ PaywallError (409)\n                             │ no                  │\n                             ▼                     ▼\n                  db.paywall.create(copy)    toast in the dashboard\n```",
          risks: [
            {
              title: 'Existing copies stay as they are',
              risk: 'Copies made from code-first paywalls before this change still exist and behave like visual paywalls nobody maintains. They are not touched here.',
              file: null,
              line: null,
              end: null,
            },
            {
              title: 'Old dashboards show a generic error',
              risk: 'Older dashboard builds switch on the error code and have no case for `code_first_duplicate`, so they show the generic “Something went wrong” until they update.',
              file: errorsFile,
              ...rangeOf(ERRORS_NEW, 'export type PaywallErrorCode', 'export type PaywallErrorCode'),
            },
          ],
          testing: {
            automated: [
              '`duplicate.test.ts` covers both kinds: a visual paywall is copied, a code-first one is refused with the repository message.',
            ],
            manual: [
              {
                action: 'Run the duplicate tests on the branch.',
                target: { kind: 'command', value: 'bun test src/paywalls/duplicate.test.ts' },
                expect: 'Both cases pass: the visual copy and the refused code-first paywall.',
              },
              {
                action: 'Start the dashboard and open the paywall list.',
                target: { kind: 'url', value: 'http://localhost:5173/paywalls' },
                expect: 'The list loads with both visual and code-first paywalls.',
              },
              {
                action: 'Open a code-first paywall and press Duplicate.',
                target: null,
                expect:
                  'A toast says code-first paywalls are duplicated from their repository, and no copy appears in the list.',
              },
              {
                action: 'Duplicate a visual paywall the same way.',
                target: null,
                expect: 'A copy named “… (copy)” appears at the top of the list, as before.',
              },
              {
                action: 'Call the API directly for a code-first paywall.',
                target: {
                  kind: 'command',
                  value: 'curl -i -X POST http://localhost:8787/paywalls/pw_code_first/duplicate',
                },
                expect: 'A 409 with `code_first_duplicate` and the same message as the toast.',
              },
              {
                action: 'Read the guard where every duplicate starts.',
                target: {
                  kind: 'file',
                  value: `${duplicateFile}:${lineOf(DUPLICATE_NEW, "if (source.kind === 'code_first')")}-${lineOf(DUPLICATE_NEW, "throw new PaywallError('code_first_duplicate'")}`,
                },
                expect: 'The check runs before the copy is written, so the template job is covered too.',
              },
            ],
          },
          steps: [
            {
              when: 'pre_merge',
              kind: 'env',
              title: 'Set `CODE_FIRST_DOCS_URL` on the API in production',
              detail:
                'The refusal message links to it. Use `https://docs.superwall.com/paywalls/code-first#duplicate`; without it the message links to the docs home.',
              command:
                'railway variables --service api --environment production --set CODE_FIRST_DOCS_URL=https://docs.superwall.com/paywalls/code-first#duplicate',
            },
            {
              when: 'pre_merge',
              kind: 'config',
              title: 'Add `code_first_duplicate` to the API error alerts allowlist',
              detail:
                'In Sentry, project `api`: a 409 with this code is expected, so it should not page anyone.',
              command: null,
            },
            {
              when: 'post_merge',
              kind: 'deploy',
              title: 'Release the dashboard',
              detail:
                'Older dashboard builds show “Something went wrong” for the new code until they update; this release shows the message.',
              command: 'bun run --cwd apps/dashboard release',
            },
          ],
        },
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
      pullRequest: {
        number: 4531,
        checks: 'passing',
        ciRuns: [
          {
            name: 'lint',
            status: 'success',
            required: true,
            url: 'https://github.com/superwall/paywall-next/actions/runs/91822',
          },
          {
            name: 'check-types',
            status: 'success',
            required: true,
            url: 'https://github.com/superwall/paywall-next/actions/runs/91822',
          },
          {
            name: 'test (ubuntu)',
            status: 'success',
            required: true,
            url: 'https://github.com/superwall/paywall-next/actions/runs/91823',
          },
          {
            name: 'test (macos)',
            status: 'success',
            required: false,
            url: 'https://github.com/superwall/paywall-next/actions/runs/91823',
          },
          {
            name: 'Vercel preview',
            status: 'success',
            required: false,
            url: 'https://vercel.com/superwall/paywall-next',
          },
        ],
      },
      ticked: ['Set `CODE_FIRST_DOCS_URL` on the API in production'],
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
      stage: 'awaiting_review',
      reason: 'built, checked and ready for review',
      branch: 'refactor/command-registry',
      ageHours: 5,
      checkResults: {
        c1: {
          detail: 'src/cli/help.test.ts timed out under load and passed when re-run alone.',
          note: 'passed_alone',
        },
      },
      worktreePath: worktrees.registry,
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
          'Introduce defineCommand({ name, args, flags, run }) and migrate all 31 commands in this task. A codemod handles the commands with plain flags; the ones that read positional arguments or stdin are done by hand. The old flag parser stays behind an opt-in variable until the next release.',
        files: [
          { path: 'src/cli/registry.ts', change: 'New defineCommand, flag builders and the parser.' },
          { path: 'src/cli/commands/*.ts', change: 'Migrated to defineCommand.' },
          { path: 'src/cli/help.ts', change: 'New: help rendered from a definition.' },
          { path: 'scripts/generate-command-docs.ts', change: 'New: one docs page per command.' },
          { path: 'src/mcp/commands.ts', change: 'New: commands listed as MCP tools.' },
        ],
        outOfScope: ['Changing any command’s behaviour.'],
        verification: [
          createPlanCheck('CLI help and flags', 'bun test src/cli', [1, 2, 3, 5]),
          createPlanCheck('Commands as MCP tools', 'bun test src/mcp/commands.test.ts', [4, 5]),
          createPlanCheck('Docs generator types', 'bunx tsc --noEmit -p scripts', [3]),
        ],
        questions: [],
      },
      report: {
        headline:
          'All 31 framework commands now declare their arguments, flags and help in one defineCommand call, and the CLI help, the docs pages and the MCP tool list are generated from it.',
        sections: [
          {
            title: 'Define the command schema',
            summary:
              'registry.ts adds defineCommand, small flag builders and parseInput, which rejects unknown flags and suggests the closest one.',
            spots: [
              spot(
                CLI_PATHS.registry,
                REGISTRY_NEW,
                'export const flag = {',
                "number: createFlag('number'),",
                'normal',
                {
                  title: 'Flag builders',
                  why: 'Every command’s flags go through these three builders; the kind decides how parseInput reads the value.',
                  explain:
                    '`flag.string`, `flag.boolean` and `flag.number` return a `FlagSpec` with its kind, help text and optional `alias` and `default`. The generic keeps the default typed, so `flag.number(..., { default: 120 })` will not accept a string.',
                }
              ),
              spot(
                CLI_PATHS.registry,
                REGISTRY_NEW,
                'export function defineCommand',
                'return definition as unknown as CommandDefinition;',
                'high',
                {
                  title: 'One command, typed inside, plain outside',
                  why: 'The cast drops the per-command flag types once the definition leaves the file.',
                  explain:
                    'Inside a command file `run` sees `flags.wait` as `number | undefined`. The return value is widened to the plain `CommandDefinition` so 31 differently typed commands fit in one `COMMANDS` array.',
                }
              ),
              spot(
                CLI_PATHS.registry,
                REGISTRY_NEW,
                "const [raw = '', inline] = token",
                'if (!spec) throw new UsageError',
                'critical',
                {
                  title: 'Split a flag from its value',
                  why: '`split` with a limit drops everything after the second `=`, so values containing `=` are cut.',
                  explain:
                    'A token like `--app=demo` is split into the flag name and an inline value. The name goes through the alias lookup, and a name the command does not declare is a `UsageError` instead of being passed through, which is what the old parser did.',
                }
              ),
              spot(
                CLI_PATHS.registry,
                REGISTRY_NEW,
                "if (spec.kind === 'boolean') {",
                "flags[name] = spec.kind === 'number'",
                'critical',
                {
                  title: 'Read the value by kind',
                  why: 'There is no branch for `--no-<flag>`, which the old parser supported.',
                  explain:
                    'Booleans take no value: `--json` is true and `--json=false` is false. Strings and numbers take the inline value or the next token, and a missing one is a usage error naming the flag.',
                }
              ),
              spot(
                CLI_PATHS.suggest,
                SUGGEST_NEW,
                'for (const name of names)',
                'if (distance <= MAX_DISTANCE',
                'normal',
                {
                  title: 'Suggest the closest flag',
                  why: 'Two edits is tight: `--no-cache` against `cache` is three, so it gets no suggestion.',
                  explain:
                    '`suggestName` counts edits between the typed name and every declared flag and keeps the closest one within two edits. `--apps` suggests `--app`; `--frobnicate` suggests nothing.',
                }
              ),
            ],
          },
          {
            title: 'Port the existing commands',
            summary:
              'A codemod moved the 28 commands with plain flags onto defineCommand; deploy, login and logs were ported by hand.',
            spots: [
              spot(CLI_PATHS.commands, COMMAND_INDEX_NEW, 'export const COMMANDS', '  campaigns,', 'normal', {
                title: 'Every command in one list',
                why: 'A command that is not imported here does not exist: no help, no docs page, no tool.',
                explain:
                  '`COMMANDS` is a plain array of the 31 default exports, sorted by name. The CLI, the docs script and the MCP server all read this list, so they cannot disagree about what exists.',
              }),
              spot(
                CLI_PATHS.push,
                PUSH_NEW,
                'cache: flag.boolean(',
                'run: ({ flags }) => runPush(flags),',
                'critical',
                {
                  title: 'Defaults carried over from the old parser',
                  why: '`cache` defaults to true and the only way to turn it off was `--no-cache`, which the new parser rejects.',
                  explain:
                    'The codemod read the old `parseFlags` options and wrote one builder call per flag, keeping `default: { cache: true }` as `{ default: true }`. `run` receives the parsed flags as they are.',
                }
              ),
              spot(
                CLI_PATHS.deploy,
                DEPLOY_NEW,
                "args: [{ name: 'environment'",
                'run: ({ args, flags }) => runDeploy',
                'high',
                {
                  title: 'Positional arguments are declared too',
                  why: 'The `staging` fallback can never apply now that the argument is required, so it only hides a mistake.',
                  explain:
                    '`deploy` takes the environment as an argument. Declaring it makes the help show `<environment>` and lets `parseInput` fail early with “deploy needs <environment>.” instead of the action throwing later.',
                }
              ),
              spot(
                CLI_PATHS.codemod,
                CODEMOD_NEW,
                'if (!parse?.[1] || !action',
                'const options = Function(',
                'high',
                {
                  title: 'Port only what the codemod understands',
                  why: '`Function` evaluates the options object from the source. Safe here because it runs once on our own files, never on input.',
                  explain:
                    'A command is rewritten only when it has one `parseFlags(argv, {...})` call, passes `flags` straight to its action and never reads positional `flags._`. Anything else is skipped with a warning and was ported by hand.',
                }
              ),
            ],
          },
          {
            title: 'Generate docs and help',
            summary:
              'help.ts renders usage and flags from a definition; the docs script writes one page per visible command; the CLI prints help before parsing.',
            spots: [
              spot(
                CLI_PATHS.help,
                HELP_NEW,
                'for (const [name, spec] of flags)',
                'lines.push(`  ',
                'normal',
                {
                  title: 'Help from the definition',
                  why: 'Help is aligned by padding names, so a very long flag name widens every line.',
                  explain:
                    'Each flag becomes one line: the short alias if any, the name padded to the longest one, the help text and the default. Commands without flags print usage and the summary only.',
                }
              ),
              spot(
                CLI_PATHS.docs,
                DOCS_SCRIPT_NEW,
                'for (const command of visible)',
                'writeFileSync(join(OUT, `',
                'normal',
                {
                  title: 'One docs page per command',
                  why: 'Pages are only written, never removed.',
                  explain:
                    'The page is the command name, its summary and the same help text the CLI prints, in a code block. The script runs in the docs build, so the pages cannot drift from the CLI.',
                }
              ),
              spot(
                CLI_PATHS.index,
                CLI_INDEX_NEW,
                "if (name === 'help'",
                "if (rest.includes('--help'))",
                'normal',
                {
                  title: 'Help before parsing',
                  why: '`--help` anywhere in the arguments wins, even as the value of a string flag.',
                  explain:
                    '`superwall help deploy` and `superwall deploy --help` print the same text. Help is checked before `parseInput`, so asking for help never fails on a missing argument.',
                }
              ),
            ],
          },
          {
            title: 'Expose the commands to agents',
            summary:
              'The MCP server lists every visible command as a tool, with an input schema built from its flags.',
            spots: [
              spot(
                CLI_PATHS.mcp,
                MCP_COMMANDS_NEW,
                'return COMMANDS.filter',
                'inputSchema: resolveInputSchema(command),',
                'high',
                {
                  title: 'Commands become tools',
                  why: 'Every visible command, including deploy and rollback, is offered to agents unless it sets `agents: false`.',
                  explain:
                    'Each command becomes a tool named `superwall.<command>` with its summary as the description. `hidden` commands and those marked `agents: false` (login, for its token) are left out.',
                }
              ),
              spot(
                CLI_PATHS.mcp,
                MCP_COMMANDS_NEW,
                'if (args.length > 0) {',
                "return { type: 'object', properties",
                'normal',
                {
                  title: 'Arguments as one array',
                  why: 'The array has no `items`, which strict JSON schema validators reject.',
                  explain:
                    'Flags map one to one onto properties, using the flag kind as the JSON type. Positional arguments become one `args` array described by their names, required when any argument is.',
                }
              ),
            ],
          },
          {
            title: 'Verify every command',
            summary:
              'A snapshot of every command’s help, a check that no flag lacks help text, and two parser tests.',
            spots: [
              spot(
                CLI_PATHS.test,
                HELP_TEST_NEW,
                'for (const command of COMMANDS)',
                'toMatchSnapshot',
                'normal',
                {
                  title: 'A snapshot per command',
                  why: 'Snapshots show the help changed, not that the parsing behaves as before.',
                  explain:
                    'One test per command renders its help and compares it with the stored snapshot, so any change to a flag, default or summary shows up in review as a snapshot diff.',
                }
              ),
              spot(
                CLI_PATHS.test,
                HELP_TEST_NEW,
                "it('gives every flag a help text'",
                'expect(missing).toEqual([]);',
                'normal',
                {
                  title: 'No flag without help',
                  why: 'The codemod writes an empty string when `flag-help.json` has no entry; this test is what catches it.',
                  explain:
                    'Collects every `command --flag` pair whose help is empty and expects none. The failure message lists them, which is how the four missing texts were found during the port.',
                }
              ),
            ],
          },
        ],
        judgementCalls: [
          {
            title: 'A static command list',
            call: 'A static list of commands instead of scanning the folder',
            reason:
              'The CLI ships as one bundle, so a folder scan at runtime finds nothing. An import per command is 31 lines and makes the list explicit.',
            file: CLI_PATHS.commands,
            ...rangeOf(COMMAND_INDEX_NEW, 'export const COMMANDS', 'export const COMMANDS'),
            alternatives: [
              {
                option: 'Glob src/cli/commands at startup',
                rejected:
                  'The bundled CLI has no commands folder, and reading files on every start slows `superwall --help`.',
              },
              {
                option: 'Register from each command file as a side effect',
                rejected:
                  'Order would depend on import order, and a file nobody imports would silently drop its command.',
              },
            ],
          },
          {
            title: 'Own flag builders, no zod',
            call: 'Wrote small flag builders instead of using zod',
            reason:
              'The schema needs help text, aliases and positional arguments as much as types. Three builders cover that in 15 lines and keep the CLI start fast.',
            file: CLI_PATHS.registry,
            ...rangeOf(REGISTRY_NEW, 'export const flag = {', "number: createFlag('number'),"),
            alternatives: [
              {
                option: 'zod schemas with describe() for help',
                rejected:
                  'Aliases and positional arguments would sit outside the schema anyway, and it adds a dependency to every CLI start.',
              },
              {
                option: 'commander or yargs',
                rejected:
                  'They own parsing, dispatch and help, so the docs and the MCP list would have to read their internals.',
              },
            ],
          },
          {
            title: 'Codemod most commands',
            call: 'Codemod for 28 commands, 3 ported by hand',
            reason:
              'Most commands pass their flags straight to an action, which a regex can read reliably. deploy, login and logs do more and needed a person.',
            file: CLI_PATHS.codemod,
            ...rangeOf(CODEMOD_NEW, 'if (!parse?.[1] || !action', 'console.warn(`Skipped'),
            alternatives: [
              {
                option: 'Port all 31 by hand',
                rejected: 'A day of identical edits, with typos the snapshots would only partly catch.',
              },
              {
                option: 'Codemod everything with a TypeScript AST',
                rejected: 'More code than the three commands it would save, and it would run once.',
              },
            ],
          },
          {
            title: 'Keep the old parser behind a flag',
            call: 'Kept the old parser behind SUPERWALL_LEGACY_FLAGS=1',
            reason:
              'You asked to keep it during the migration. Opting in with a variable keeps one parser in charge by default.',
            file: CLI_PATHS.index,
            ...rangeOf(
              CLI_INDEX_NEW,
              'const legacy = env.SUPERWALL_LEGACY_FLAGS',
              'await command.run(legacy'
            ),
            alternatives: [
              {
                option: 'Retry with the old parser when the new one throws',
                rejected: 'Typos would be accepted again, and the same command line could mean two things.',
              },
            ],
          },
          {
            title: 'Exit code 2 for usage errors',
            call: EXIT_CODE_CALL,
            reason:
              'Scripts can then tell a typo from a failed deploy. 2 is what most CLIs use for usage errors.',
            file: CLI_PATHS.index,
            ...rangeOf(CLI_INDEX_NEW, 'function fail(message: string', 'process.exit(2);'),
            alternatives: [
              {
                option: 'Keep exit code 1 for everything',
                rejected:
                  'A CI step cannot tell “wrong flag” from “the deploy failed” without parsing stderr.',
              },
            ],
          },
        ],
        walkthrough: {
          approach:
            'Before this change each command parsed its own `argv` with `parseFlags`, which accepted any flag, and the help and the docs were written by hand. Now each command file exports one `defineCommand({ name, summary, args, flags, run })`, and everything else reads that definition.\n\n`registry.ts` holds the types, the flag builders and `parseInput`. `commands/index.ts` lists all 31 commands. The CLI entry, `help.ts`, the docs script and the MCP server read that list.\n\nThe port ran in two passes: a codemod rewrote the 28 commands that pass their flags straight to an action, and deploy, login and logs were ported by hand. Behaviour stayed the same except where the old parser was lax: unknown flags now fail with a suggestion.',
          flow: '1. `main(argv)` takes the command name. `help`, `--help` and unknown names print help without parsing.\n2. The command is looked up in `BY_NAME`, built once from `COMMANDS`.\n3. `parseInput` fills defaults, then walks the tokens: plain tokens are arguments, `--name` and `--name=value` are flags, aliases resolve through `alias`.\n4. An undeclared flag throws a `UsageError` with the closest declared name, if one is within two edits.\n5. Required arguments are checked, then `run({ args, flags })` is called.\n6. A `UsageError` prints the message and the command’s help and exits with 2; any other error propagates as before.\n\n```text\ncommands/*.ts ── defineCommand ──▶ COMMANDS\n                                      │\n        ┌─────────────────────────────┼─────────────────────┐\n        ▼                             ▼                     ▼\ncli/index.ts                help.ts, docs script     mcp/commands.ts\nparseInput ──▶ run          --help, cli/*.mdx        superwall.<name>\n```\n\nWith `SUPERWALL_LEGACY_FLAGS=1`, step 3 uses the old `parseFlags` instead and steps 4 and 5 are skipped.',
          risks: [
            {
              title: 'Short flags do not combine',
              risk: 'Short flags cannot be combined: `-fv` is looked up as one flag named `fv` and fails. Only `logs -f` and `deploy -m` have short forms today.',
              file: CLI_PATHS.registry,
              ...rangeOf(REGISTRY_NEW, "const [raw = '', inline] = token", 'const name = resolveFlagName'),
            },
            {
              title: 'Bad numbers become NaN',
              risk: 'Number flags are read with `Number()`, so `--wait soon` becomes `NaN` instead of a usage error.',
              file: CLI_PATHS.registry,
              ...rangeOf(
                REGISTRY_NEW,
                'const value = inline ?? argv[++index];',
                "flags[name] = spec.kind === 'number'"
              ),
            },
            {
              title: 'Stale pages for removed commands',
              risk: 'The docs script only writes pages. A renamed or removed command leaves its old page in `docs/cli` until someone deletes it.',
              file: CLI_PATHS.docs,
              ...rangeOf(DOCS_SCRIPT_NEW, 'mkdirSync(OUT', 'for (const command of visible)'),
            },
            {
              title: 'Agents can deploy unconfirmed',
              risk: '`deploy`, `promote` and `rollback` are offered to agents as tools with no confirmation of their own; only the MCP client’s approval stands between an agent and production.',
              file: CLI_PATHS.mcp,
              ...rangeOf(MCP_COMMANDS_NEW, 'return COMMANDS.filter', 'name: `superwall.'),
            },
            {
              title: 'Legacy mode hides the new errors',
              risk: 'With `SUPERWALL_LEGACY_FLAGS=1` unknown flags are accepted silently again, so a script that sets it never sees the new errors.',
              file: CLI_PATHS.index,
              ...rangeOf(
                CLI_INDEX_NEW,
                'const legacy = env.SUPERWALL_LEGACY_FLAGS',
                'await command.run(legacy'
              ),
            },
          ],
          testing: {
            automated: [
              '`help.test.ts` snapshots the help of all 31 commands and fails when any flag has no help text.',
              'Two parser tests: an unknown flag suggests the closest one, and `deploy` without an environment asks for it.',
            ],
            manual: [
              {
                action: 'Run a command with a misspelled flag from the worktree.',
                target: { kind: 'command', value: 'bun src/cli/index.ts push --apps demo' },
                expect: 'The CLI stops with “Did you mean --app?” instead of pushing.',
              },
              {
                action: 'Run deploy without an environment.',
                target: { kind: 'command', value: 'bun src/cli/index.ts deploy' },
                expect: 'It asks for `<environment>` and exits without building anything.',
              },
              {
                action: 'Print the help for every command.',
                target: { kind: 'command', value: 'bun src/cli/index.ts --help' },
                expect: 'All 31 commands are listed, each with a one-line summary and no empty flag help.',
              },
              {
                action: 'Generate the command docs and compare them with the hand-written pages.',
                target: {
                  kind: 'command',
                  value: 'bun scripts/generate-command-docs.ts && git diff --stat docs/cli',
                },
                expect: 'Only wording differences, and every command and flag still has a page entry.',
              },
              {
                action: 'Read how the MCP server builds its tool list from the registry.',
                target: { kind: 'file', value: CLI_PATHS.mcp },
                expect: '`login` is left out, and `deploy` gets an `args` property from its definition.',
              },
            ],
          },
        },
      },
      reviewSummary:
        'I read the registry, the parser, the codemod and a sample of the ported commands, ran every command’s help, and tried the flags used in the docs. The structure is sound; the parser drops two things the old one handled, negated flags and values containing =.',
      reviewDisagreements: [
        {
          call: EXIT_CODE_CALL,
          reason:
            'The plan kept behaviour changes out of scope, and the CI examples in the docs check for exit code 1. Changing it is reasonable but belongs in its own task with a release note.',
        },
      ],
      findings: [
        {
          severity: 'blocking',
          file: CLI_PATHS.registry,
          ...rangeOf(REGISTRY_NEW, "if (spec.kind === 'boolean') {", "flags[name] = inline !== 'false';"),
          title: 'Negated flags no longer work',
          message:
            'The old parser read `--no-cache` as `cache: false`. parseInput has no `no-` branch, so `superwall push --no-cache`, which the deploy guide uses, fails as an unknown flag, with no suggestion.',
          fix: "Accept the negated form of boolean flags before the lookup:\n\n```ts\nconst negated = raw.startsWith('no-') && command.flags[raw.slice(3)]?.kind === 'boolean';\nif (negated) {\n  flags[raw.slice(3)] = false;\n  continue;\n}\n```",
        },
        {
          severity: 'blocking',
          file: CLI_PATHS.registry,
          ...rangeOf(REGISTRY_NEW, "const [raw = '', inline] = token", "const [raw = '', inline] = token"),
          title: 'Values containing = are cut',
          message:
            "`split('=', 2)` drops everything after the second `=`, so `env-set --value=c2VjcmV0==` stores `c2VjcmV0`. Base64 values end in `=`, so this corrupts real secrets without an error.",
          fix: "Split on the first `=` only:\n\n```ts\nconst body = token.replace(/^--?/, '');\nconst at = body.indexOf('=');\nconst raw = at < 0 ? body : body.slice(0, at);\nconst inline = at < 0 ? undefined : body.slice(at + 1);\n```",
        },
        {
          severity: 'should_fix',
          file: CLI_PATHS.mcp,
          ...rangeOf(MCP_COMMANDS_NEW, 'properties.args = {', 'properties.args = {'),
          title: 'The args schema has no items',
          message:
            '`args` is declared as an array without `items`. Strict MCP clients validate every tool schema and drop the whole list over one invalid entry.',
          fix: "Declare the item type: `{ type: 'array', items: { type: 'string' }, description }`.",
        },
      ],
      runs: [
        {
          role: 'agent',
          purpose: 'plan',
          minutes: 8,
          summary: 'Proposed the registry plan; you chose to port all 31 commands.',
        },
        {
          role: 'agent',
          purpose: 'build',
          minutes: 58,
          summary: 'Built the registry and ported all 31 commands.',
        },
        {
          role: 'reviewer',
          minutes: 6,
          summary: 'Two blocking findings in the flag parser, one suggestion.',
        },
      ],
      gate: {
        type: 'review',
        title: 'Review the command registry rewrite',
        body: 'Built, checked and reviewed by an agent. Two blocking findings and one suggestion left for you to judge.',
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
      verification: [createPlanCheck('Tab group scrolling', 'bun test src/ui/tab-group.test.tsx', [1, 2, 3])],
      checkResults: { c1: { detail: '2 tests, both new' } },
      worktreePath: tabsPath,
      report: {
        headline: 'Tab groups scroll sideways and keep the active tab in view.',
        sections: [
          {
            title: 'Find why the tabs overflow',
            summary:
              'The row was a plain flex container, so extra tabs shrank until their labels clipped, then overflowed the panel.',
            spots: [
              spot(
                tabsFile,
                TAB_GROUP_NEW,
                'data-active={tab.id === active}',
                "className='shrink-0'",
                'normal',
                {
                  title: 'Tabs keep their width',
                  why: 'Without `shrink-0` the flex row squeezes every tab before it ever scrolls.',
                  explain:
                    'Flex items shrink by default. `shrink-0` keeps each tab at its label’s width, so a crowded group overflows the row instead of clipping the labels.',
                }
              ),
            ],
          },
          {
            title: 'Scroll the row',
            summary:
              'The row scrolls horizontally with the scrollbar hidden, and selecting a tab scrolls it to the centre.',
            spots: [
              spot(tabsFile, TAB_GROUP_NEW, '<div ref={listRef}', '{tabs.map((tab) => (', 'normal', {
                title: 'The row scrolls, the page does not',
                why: 'Hidden scrollbar: there is no visual hint more tabs exist off-screen.',
                explain:
                  '`overflow-x-auto` makes the row scroll, `overscroll-x-contain` stops a trackpad swipe at the end from going back in history, and `[scrollbar-width:none]` hides the bar.',
              }),
              spot(tabsFile, TAB_GROUP_NEW, 'React.useEffect', '}, [active]);', 'high', {
                title: 'Scroll the active tab into view',
                why: 'Smooth scrolling runs on first render too, so the row animates on page load.',
                explain:
                  'Whenever `active` changes, the effect finds the selected button by `data-active` and calls `scrollIntoView` with `inline: center`. `block: nearest` keeps the page from scrolling vertically to reach the row.',
              }),
            ],
          },
          {
            title: 'Test it',
            summary: 'Two component tests with 40 tabs.',
            spots: [
              spot(
                tabsTestFile,
                TAB_GROUP_TEST_NEW,
                "it('scrolls the active tab to the centre'",
                'expect(scrollIntoView).toHaveBeenLastCalledWith',
                'normal',
                {
                  title: 'Selecting a tab scrolls it',
                  why: 'jsdom has no layout, so the test checks the call, not where the row ends up.',
                  explain:
                    'Replaces `scrollIntoView` with a mock, renders 40 tabs, selects tab 31 and checks the last call asked for the centre.',
                }
              ),
              spot(
                tabsTestFile,
                TAB_GROUP_TEST_NEW,
                "it('keeps every tab at its natural width'",
                "tab.classList.contains('shrink-0')",
                'normal',
                {
                  title: 'No tab can shrink',
                  why: 'A class check: it fails if the class is removed, not if another class overrides it.',
                  explain: 'Renders 40 tabs and checks that every button keeps `shrink-0`.',
                }
              ),
            ],
          },
        ],
        judgementCalls: [
          {
            title: 'Centre the active tab',
            call: 'Centred the active tab instead of scrolling it just into view',
            reason:
              'Centring shows the tabs on both sides of the selection, so you can see there is more in either direction.',
            file: tabsFile,
            ...rangeOf(TAB_GROUP_NEW, 'selected?.scrollIntoView', 'selected?.scrollIntoView'),
            alternatives: [
              {
                option: "inline: 'nearest'",
                rejected:
                  'The tab lands flush with the edge, so the next one is always hidden and the row looks like it ends there.',
              },
            ],
          },
          {
            title: 'Hide the scrollbar',
            call: 'Hid the scrollbar',
            reason:
              'The tab row is 32px tall. A horizontal scrollbar either covers the labels or adds a strip under the row, depending on the system setting.',
            file: tabsFile,
            ...rangeOf(TAB_GROUP_NEW, '<div ref={listRef}', '<div ref={listRef}'),
            alternatives: [
              {
                option: 'Keep the native scrollbar',
                rejected:
                  'Overlaps the labels on macOS with scrollbars always shown, and looks different on every system.',
              },
              {
                option: 'Fade the edges with a mask',
                rejected:
                  'Needs the scroll position in state to drop the fade at either end; worth its own change.',
              },
            ],
          },
          {
            title: 'Scroll from an effect',
            call: 'Scrolled from an effect on active, not in the click handler',
            reason:
              'Tabs are also selected by keyboard shortcuts and from links, which never pass through `onClick`.',
            file: tabsFile,
            ...rangeOf(TAB_GROUP_NEW, 'React.useEffect', '}, [active]);'),
            alternatives: [
              {
                option: 'Call scrollIntoView in onClick',
                rejected: 'Misses every selection that does not come from a click.',
              },
            ],
          },
        ],
        walkthrough: {
          approach:
            'Two small changes in `TabGroup`. The row becomes a horizontal scroll container and the tabs stop shrinking, so a crowded group scrolls instead of squeezing its labels. Then an effect keeps the selected tab visible by scrolling it to the centre whenever the selection changes.\n\nNo state is added: the selected tab is found in the DOM through the `data-active` attribute the buttons already had.',
          flow: "1. The row renders with `overflow-x-auto`, and each tab keeps its width with `shrink-0`.\n2. With more tabs than fit, the row scrolls under a trackpad swipe or Shift with the wheel.\n3. When `active` changes, from a click, a shortcut or a link, the effect runs.\n4. It looks up `[data-active=\"true\"]` inside the row and scrolls it to the centre.\n\n```text\nclick, shortcut or link\n  │ onSelect(id)\n  ▼\nparent sets active ──▶ TabGroup renders the row\n  │                    overflow-x-auto, every tab shrink-0\n  ▼\nuseEffect([active])\n  │\n  ▼\nlistRef.current.querySelector('[data-active=\"true\"]')\n  │\n  ▼\nscrollIntoView({ block: 'nearest', inline: 'center' })\n```",
          risks: [
            {
              title: 'Hidden tabs give no hint',
              risk: 'Without a scrollbar or a fade, nothing shows that more tabs exist off-screen.',
              file: tabsFile,
              ...rangeOf(TAB_GROUP_NEW, '<div ref={listRef}', '<div ref={listRef}'),
            },
            {
              title: 'Vertical wheels need Shift',
              risk: 'A mouse with only a vertical wheel cannot scroll the row unless Shift is held.',
              file: tabsFile,
              ...rangeOf(TAB_GROUP_NEW, '<div ref={listRef}', '<div ref={listRef}'),
            },
            {
              title: 'The page can scroll too',
              risk: '`scrollIntoView` also scrolls scrollable ancestors. `block: nearest` keeps that to a minimum, but a page scrolled away from the row can still move.',
              file: tabsFile,
              ...rangeOf(TAB_GROUP_NEW, 'selected?.scrollIntoView', 'selected?.scrollIntoView'),
            },
          ],
          testing: {
            automated: [
              '`tab-group.test.tsx` checks that selecting a tab scrolls it to the centre and that no tab can shrink.',
            ],
            manual: [
              {
                action: 'Open the preview deployment of this branch on a paywall with many tabs.',
                target: {
                  kind: 'url',
                  value: 'https://paywall-editor-git-fix-tab-group-scroll.vercel.app/paywalls/spring-sale',
                },
                expect: 'The tab row runs past the edge and scrolls sideways instead of squeezing the tabs.',
              },
              {
                action: 'Open a group with 40 tabs and select the last one.',
                target: null,
                expect: 'The row scrolls the selected tab to the middle and every tab keeps its full width.',
              },
              {
                action: 'Scroll the row with a vertical mouse wheel, then again with Shift held.',
                target: null,
                expect: 'Only the Shift scroll moves the row; this is the known limit in the risks.',
              },
              {
                action: 'Reload the page while a late tab is selected and watch the row.',
                target: null,
                expect: 'The row starts at the selected tab without sliding into place on load.',
              },
              {
                action: 'Read the scroll call to see why the page around the row can move.',
                target: {
                  kind: 'file',
                  value: `${tabsFile}:${lineOf(TAB_GROUP_NEW, 'selected?.scrollIntoView')}`,
                },
                expect: '`block: nearest` keeps the page still unless the row is already off screen.',
              },
            ],
          },
        },
      },
      reviewSummary:
        'I read the scroll change and opened a group with 40 tabs. The row scrolls and keeps the active tab in view; the only issue is the animation on first render.',
      findings: [
        {
          severity: 'optional',
          file: 'src/ui/tab-group.tsx',
          line: lineOf(TAB_GROUP_NEW, "behavior: 'smooth'"),
          title: 'The row animates on page load',
          message:
            'The effect scrolls smoothly on mount too, so a page that opens on a later tab slides the whole row into place.',
          fix: "Scroll instantly on the first render and smoothly only after a selection, for example with a ref that records the first run:\n\n```ts\nconst behavior = mounted.current ? 'smooth' : 'instant';\nmounted.current = true;\n```",
        },
      ],
      runs: [
        { role: 'agent', purpose: 'build', minutes: 7, summary: 'Made the row scrollable.' },
        { role: 'reviewer', minutes: 2, summary: 'One suggestion.' },
      ],
      extra: listTabScrollIterations(),
      gate: {
        type: 'review',
        title: 'Review the tab group scroll fix',
        body: 'Small fix, one suggestion from the agent review.',
      },
    },
  ];
}

function listTabScrollIterations(): ShinsaEventInput[] {
  return listSeedIterations('task-tab-scroll', 'task-tab-scroll-run-0', [
    {
      text: "With the scrollbar hidden I can't tell there are more tabs. Can we show that somehow? And does this work with the arrow keys?",
      reply: {
        headline:
          'The row now fades at an edge while more tabs sit past it, and the arrow keys move between tabs.',
        points: [
          {
            ask: 'Show that there are more tabs',
            outcome: 'done',
            note: 'A fade at each edge that has tabs beyond it; it goes once you reach the end.',
          },
          {
            ask: 'Does it work with the arrow keys?',
            outcome: 'answered',
            note: 'It did not. Left and right now move the selection and scroll the new tab into view.',
          },
        ],
        next: null,
      },
    },
    {
      text: 'The active tab disappears when I make the window narrower. Keep it in view, and drop the smooth scroll on first load like the review said.',
      comments: 1,
      reply: {
        headline:
          'The active tab stays in view when the row resizes, and the first render no longer animates.',
        points: [
          {
            ask: 'Keep the active tab in view when the window narrows',
            outcome: 'done',
            note: 'A `ResizeObserver` on the row scrolls the active tab back to the centre.',
          },
          {
            ask: 'No smooth scroll on first load',
            outcome: 'done',
            note: 'The first scroll is `instant`; only later selections are smooth.',
          },
          {
            ask: 'Line comment: rename `listRef`',
            outcome: 'not_changed',
            note: 'It matches `rowRef` in the other tab components, so I kept the name for consistency.',
          },
        ],
        next: '1. Open the paywall editor on a store with more than 20 tabs, at about 900px wide.\n2. Select the last tab, then narrow the window: it should stay centred.\n3. Reload the page on a later tab: the row should not slide.',
      },
    },
  ]);
}

function listEmbeddedChatIterations(): ShinsaEventInput[] {
  return listSeedIterations('task-embedded-chat', 'task-embedded-chat-run-0', [
    {
      text: 'Tool results should be collapsed by default, they push the conversation down. Also what happens if MCP v2 is down when the chat opens?',
      reply: {
        headline:
          'Tool results start folded to one line, and the chat falls back to a clear error when MCP v2 is unreachable.',
        points: [
          {
            ask: 'Collapse tool results by default',
            outcome: 'done',
            note: 'Each result is one line with its tool name and status; click it to open the full output.',
          },
          {
            ask: 'What happens if MCP v2 is down when the chat opens?',
            outcome: 'answered',
            note: '`McpSession` retries three times over 10 seconds, then the chat shows "The assistant is offline" with a Retry button. Nothing is sent to the old `/chat` endpoint.',
          },
        ],
        next: '1. Run `bun dev` in [paywall-next](shinsa://repo/paywall-next) and open the paywall editor.\n2. Ask the assistant to list products: the tool result shows as one folded line.\n3. Stop the MCP server with `bun mcp:stop` and reload: after about 10 seconds you see the offline notice.',
      },
    },
  ]);
}

function listKeyRotationIterations(): ShinsaEventInput[] {
  return listSeedIterations('task-key-rotation', 'task-key-rotation-run-0', [
    {
      text: 'Can customers choose how long the old key keeps working? 24 hours is short for some of our bigger accounts. And please put the pepper secret in the pre-merge steps.',
      reply: {
        headline: 'The overlap stays at 24 hours, and creating `API_KEY_PEPPER` is now a pre-merge step.',
        points: [
          {
            ask: 'Let customers choose the overlap',
            outcome: 'not_changed',
            note: 'A longer overlap keeps a leaked key alive longer. I suggested a follow-up task for a per-account overlap, so it gets its own review.',
          },
          {
            ask: 'Put the pepper secret in the pre-merge steps',
            outcome: 'done',
            note: 'Step 1 now creates `API_KEY_PEPPER` in production, with the exact command.',
          },
        ],
        next: 'Tick both pre-merge steps below once they are done in production, then merge [#4548](shinsa://pr/paywall-next#4548).',
      },
    },
  ]);
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
        body: 'Exports run in 50k-row chunks. Retrying only the failed chunk is faster but needs the chunk offset persisted. Retrying the whole export is simpler and takes up to 4 minutes for the largest app.\n\nWith the offset kept, a retry picks up where the export stopped, for example:\n\n```bash\nbun run export --app app_9f2c --from-offset 150000\n```\n\nTo watch the timeout on the largest app yourself before you choose, run:\n\n```bash run\nbun run export --app app_9f2c --dry-run\n```',
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
      extra: [
        ...listDocsGateWatchdogs(),
        {
          type: 'task.messaged',
          taskId: 'task-docs-gate',
          text: 'Also drop the access gate from the skills repo, on the cli-v2 branch.',
          kind: 'separate_task',
          suggestionId: 'suggestion-docs-gate-skills',
        },
        {
          type: 'task.suggested',
          taskId: 'task-docs-gate',
          suggestion: {
            id: 'suggestion-docs-gate-skills',
            runId: null,
            title: 'Drop the access gate from the skills repo',
            request: 'Also drop the access gate from the skills repo, on the cli-v2 branch.',
            why: 'The skills repo is another repository, so it belongs in a task of its own.',
            waitsOnThis: false,
            status: 'open',
            createdTaskId: null,
            suggestedAt: NOW - HOUR,
            splitOff: true,
          },
        },
      ],
    },
    {
      id: 'task-docs-safari',
      request: [
        'Fix the blank framework docs page in Safari 17',
        '',
        'Since #339 merged, Safari 17 throws on `/docs/framework` and the page renders nothing for those visitors; Chrome and Firefox throw none. Find the cause and fix it so the page works in Safari 17.',
        '',
        'Reported in maple on 2026-10-29T03:10:00Z (https://maple.dev/superwall/errors/err-7f3a):',
        '',
        '> TypeError: undefined is not an object (evaluating `window.__gate.ready`) on /docs/framework, Safari 17.6, 41 events since 03:10.',
      ].join('\n'),
      title: 'Fix the blank framework docs page in Safari 17',
      repo: docs,
      size: 'small',
      priority: 'high',
      stage: 'planning',
      reason: 'planning the phases',
      branch: 'fix/docs-safari-blank',
      ageHours: 0.3,
      forkOf: 'task-docs-gate',
      createdBy: {
        kind: 'watchdog',
        taskId: 'task-docs-gate',
        runId: 'task-docs-gate-watch',
        requestKey: 'https://maple.dev/superwall/errors/err-7f3a',
      },
      sourceReport: {
        scheduleId: null,
        watchdogId: 'watchdog-docs-errors',
        server: 'maple',
        reportId: 'err-7f3a',
        link: 'https://maple.dev/superwall/errors/err-7f3a',
        author: null,
        postedAt: '2026-10-29T03:10:00Z',
        text: 'TypeError: undefined is not an object (evaluating `window.__gate.ready`) on /docs/framework, Safari 17.6, 41 events since 03:10.',
      },
      runs: [{ role: 'agent', purpose: 'plan', minutes: 0, summary: '' }],
    },
    {
      id: 'task-watch-support',
      request: 'watch #support for bugs, hourly',
      title: 'Watch #support for bugs',
      repo: docs,
      size: 'small',
      shape: 'answer',
      stage: 'done',
      reason: 'answered your question',
      branch: 'ask/watch-support',
      ageHours: 0.5,
      runs: [
        {
          role: 'answerer',
          minutes: 1,
          summary: 'Suggested the watch.',
          reply:
            'I suggested a watch that reads #support every hour and files a task for each new bug. It starts once you add it.',
          handover: {
            kind: 'shinsa',
            name: 'set_schedule',
            args: {
              name: 'Bugs in #support',
              message: 'File a task for each new bug in #support.',
              every_minutes: 60,
              source: 'composio-slack',
            },
          },
        },
      ],
      extra: [
        {
          type: 'watch_suggestion.recorded',
          suggestion: {
            id: 'suggestion-support-bugs',
            projectId: 'project-superwall',
            server: 'composio-slack',
            name: 'Bugs in #support',
            text: 'File a task for each new bug in #support.',
            trigger: { kind: 'interval', everyMinutes: 60 },
            timeZone: 'Europe/Berlin',
            maxRuns: null,
            origin: { kind: 'agent', taskId: 'task-watch-support', runId: 'task-watch-support-run-0' },
            status: 'open',
            scheduleId: null,
            createdAt: NOW - 25 * MINUTE,
            decidedAt: null,
          },
        },
        {
          type: 'watch_suggestion.recorded',
          suggestion: {
            id: 'suggestion-maple-errors',
            projectId: 'project-superwall',
            server: 'maple',
            name: 'Errors in Maple',
            text: 'File a task for each new error in the docs site and the API in Maple.',
            trigger: { kind: 'interval', everyMinutes: 60 },
            timeZone: 'Europe/Berlin',
            maxRuns: null,
            origin: { kind: 'source' },
            status: 'open',
            scheduleId: null,
            createdAt: NOW - 9 * DAY,
            decidedAt: null,
          },
        },
      ],
    },
    {
      id: 'task-support-intake',
      request: 'Watches composio-slack for the automation “Support reports”: The #support channel in Slack',
      title: 'Watches composio-slack for the automation “Support reports”',
      watchHome: true,
      repo: docs,
      size: 'small',
      shape: 'answer',
      stage: 'done',
      reason: 'read #support',
      branch: 'ask/support-reports',
      ageHours: 7,
      runs: [
        {
          role: 'agent',
          purpose: 'intake',
          minutes: 2,
          summary:
            'Read 6 new messages in #support. None were reports: release notes and two people saying hello.',
        },
        {
          role: 'agent',
          purpose: 'intake',
          afterMinutes: 57,
          minutes: 2,
          summary:
            'Read 3 new messages in #support: two thank-yous and a question already answered in its thread. Nothing to file.',
        },
        {
          role: 'agent',
          purpose: 'intake',
          afterMinutes: 57,
          minutes: 1,
          failed: true,
          summary: 'composio-slack did not answer: the request timed out after 60 seconds.',
        },
        {
          role: 'agent',
          purpose: 'intake',
          afterMinutes: 58,
          minutes: 4,
          summary:
            'Read 9 new messages in #support, from the two hours the last read missed. Filed 1 task: paywall prices show in dollars for visitors in Germany.',
        },
        {
          role: 'agent',
          purpose: 'intake',
          afterMinutes: 56,
          minutes: 2,
          summary:
            'Read 4 new messages in #support. One repeats the euro price report, which is already filed; nothing new to file.',
        },
        {
          role: 'agent',
          purpose: 'intake',
          afterMinutes: 116,
          minutes: 3,
          summary: 'Read 14 new messages in #support; filed 1 task and skipped 2 already filed.',
        },
      ],
    },
    {
      id: 'task-paywall-euro-prices',
      request: [
        'Show paywall prices in the visitor’s currency',
        '',
        'Visitors in Germany see the paywall prices in dollars, though the App Store charges them in euros. Show the price in the store’s currency for the visitor’s region.',
        '',
        'Reported in composio-slack by Jonas Weber (https://superwall.slack.com/archives/C04SUPPORT/p1761711000):',
        '',
        '> Our German users keep asking why the paywall says $9.99 when the App Store then charges them 9,99 €. Can it show euros?',
      ].join('\n'),
      title: 'Show paywall prices in the visitor’s currency',
      repo: paywall,
      size: 'small',
      priority: 'high',
      stage: 'building',
      reason: 'building phase 1 of 2',
      branch: 'fix/paywall-local-currency',
      ageHours: 3.8,
      createdBy: {
        kind: 'intake',
        taskId: 'task-support-intake',
        runId: 'task-support-intake-run-3',
        requestKey: 'https://superwall.slack.com/archives/C04SUPPORT/p1761711000',
      },
      sourceReport: {
        scheduleId: 'schedule-support',
        watchdogId: null,
        server: 'composio-slack',
        reportId: '1761711000.002300',
        link: 'https://superwall.slack.com/archives/C04SUPPORT/p1761711000',
        author: 'Jonas Weber',
        postedAt: new Date(NOW - 4 * HOUR).toISOString(),
        text: 'Our German users keep asking why the paywall says $9.99 when the App Store then charges them 9,99 €. Can it show euros?',
      },
      runs: [
        {
          role: 'agent',
          purpose: 'plan',
          minutes: 6,
          summary: 'Planned two phases: read the store currency, then format it.',
        },
        { role: 'agent', purpose: 'build', minutes: 0, summary: '' },
      ],
    },
    {
      id: 'task-docs-mobile-sign-in',
      request: [
        'Stop the framework docs asking for sign-in on mobile',
        '',
        'Since the access gate came off the framework docs, Safari on iOS still shows the sign-in sheet on `/docs/framework` after a refresh. Find why the gate still runs there and remove it.',
        '',
        'Reported in composio-slack by Ana Ruiz on 2026-10-29T08:12:00Z (https://superwall.slack.com/archives/C04SUPPORT/p1761725520):',
        '',
        '> The framework docs keep asking me to sign in on my phone. Desktop is fine since this week, but on my iPhone it shows the sign-in sheet every time I refresh.',
      ].join('\n'),
      title: 'Stop the framework docs asking for sign-in on mobile',
      repo: docs,
      size: 'small',
      stage: 'planning',
      reason: 'planning the phases',
      branch: 'fix/docs-mobile-sign-in',
      ageHours: 0.6,
      forkOf: 'task-docs-gate',
      createdBy: {
        kind: 'intake',
        taskId: 'task-support-intake',
        runId: 'task-support-intake-run-5',
        requestKey: 'https://superwall.slack.com/archives/C04SUPPORT/p1761725520',
      },
      sourceReport: {
        scheduleId: 'schedule-support',
        watchdogId: null,
        server: 'composio-slack',
        reportId: '1761725520.004100',
        link: 'https://superwall.slack.com/archives/C04SUPPORT/p1761725520',
        author: 'Ana Ruiz',
        postedAt: new Date(NOW - 50 * MINUTE).toISOString(),
        text: 'The framework docs keep asking me to sign in on my phone. Desktop is fine since this week, but on my iPhone it shows the sign-in sheet every time I refresh.',
      },
      runs: [{ role: 'agent', purpose: 'plan', minutes: 0, summary: '' }],
    },
  ];
}

function listDocsGateWatchdogs(): ShinsaEventInput[] {
  const mergedAt = NOW - 30 * HOUR;
  const base = {
    round: 1,
    sourceRequest: null,
    runId: null,
    forkTaskIds: [],
    linkedTaskIds: [],
    armedAt: mergedAt,
    awaitingSince: null,
    startedAt: mergedAt,
  };
  const tripped = 'watchdog-docs-errors';
  return [
    {
      type: 'watchdog.armed',
      taskId: 'task-docs-gate',
      watchdog: {
        ...base,
        id: tripped,
        title: 'Docs errors in Safari and Chrome',
        check: 'No new client errors from /docs/framework in any browser since the merge.',
        source: { server: 'maple', data: 'OpenTelemetry traces and logs of the docs site and the API' },
        firstCheckMinutes: 30,
        maxGapMinutes: 6 * 60,
        forMinutes: 72 * 60,
        startsOn: 'merge',
        productionCheck: null,
        status: 'watching',
        endsAt: mergedAt + 72 * HOUR,
        nextCheckAt: NOW - HOUR,
        checks: [
          { at: mergedAt + 30 * MINUTE, healthy: true, summary: 'No client errors from /docs/framework.' },
          { at: mergedAt + 90 * MINUTE, healthy: true, summary: 'No client errors from /docs/framework.' },
        ],
        endedAt: null,
      },
    },
    {
      type: 'watchdog.checked',
      taskId: 'task-docs-gate',
      watchdogId: tripped,
      check: {
        at: NOW - HOUR,
        healthy: false,
        summary:
          'Safari 17 threw `TypeError: undefined is not an object` on `/docs/framework` 41 times since 03:10; Chrome and Firefox threw none.',
      },
      status: 'tripped',
      nextCheckAt: null,
      forkTaskIds: ['task-docs-safari'],
    },
    {
      type: 'watch_source.written',
      projectId: 'project-superwall',
      source: {
        server: 'maple',
        data: 'OpenTelemetry traces and logs of the docs site and the API',
        repoIds: [],
        addedBy: 'you',
        addedAt: NOW - 9 * DAY,
      },
    },
    {
      type: 'watch_source.written',
      projectId: 'project-superwall',
      source: {
        server: 'composio-slack',
        data: 'The #support channel in Slack',
        repoIds: ['repo-docs'],
        addedBy: 'agent',
        addedAt: mergedAt,
      },
    },
    {
      type: 'watchdog.armed',
      taskId: 'task-docs-gate',
      watchdog: {
        ...base,
        id: 'watchdog-docs-traffic',
        title: 'Framework docs traffic',
        check: 'Requests to /docs/framework keep returning 200, and the 404 rate stays under 0.5%.',
        source: { server: 'maple', data: 'OpenTelemetry traces and logs of the docs site and the API' },
        firstCheckMinutes: 30,
        maxGapMinutes: 6 * 60,
        forMinutes: 72 * 60,
        startsOn: 'merge',
        productionCheck: null,
        status: 'watching',
        endsAt: mergedAt + 72 * HOUR,
        nextCheckAt: mergedAt + 31.5 * HOUR,
        checks: [0.5, 1.5, 3.5, 7.5, 13.5, 19.5, 25.5].map((hours) => ({
          at: mergedAt + hours * HOUR,
          healthy: true,
          summary: `${Math.round(180 + hours * 40)} requests since the last check, all 200; 404 rate 0.1%.`,
        })),
        endedAt: null,
      },
    },
    {
      type: 'watchdog.armed',
      taskId: 'task-docs-gate',
      watchdog: {
        ...base,
        id: 'watchdog-docs-support',
        title: 'Support messages about the docs',
        check: 'No message in #support says the framework docs ask for access or are blank.',
        source: { server: 'composio-slack', data: 'The #support channel in Slack' },
        firstCheckMinutes: 30,
        maxGapMinutes: 12 * 60,
        forMinutes: 24 * 60,
        startsOn: 'merge',
        productionCheck: null,
        status: 'passed',
        endsAt: mergedAt + 24 * HOUR,
        nextCheckAt: null,
        checks: [12, 24].map((hours) => ({
          at: mergedAt + hours * HOUR,
          healthy: true,
          summary: 'No message in #support mentions the framework docs since the merge.',
        })),
        endedAt: mergedAt + 24 * HOUR,
      },
    },
    {
      type: 'watchdog.armed',
      taskId: 'task-docs-gate',
      watchdog: {
        ...base,
        id: 'watchdog-docs-production',
        title: 'Docs on the production site',
        check:
          'superwall.com/docs/framework serves the page to visitors who are not signed in, with no access prompt.',
        source: { server: 'maple', data: 'OpenTelemetry traces and logs of the docs site and the API' },
        firstCheckMinutes: 15,
        maxGapMinutes: 4 * 60,
        forMinutes: 72 * 60,
        startsOn: 'production',
        productionCheck:
          'The production deployment of the docs site on Vercel includes the merge commit of #339.',
        status: 'awaiting_production',
        awaitingSince: mergedAt,
        startedAt: null,
        endsAt: null,
        nextCheckAt: NOW + 20 * MINUTE,
        checks: [],
        endedAt: null,
      },
    },
    {
      type: 'watchdog.armed',
      taskId: 'task-docs-gate',
      watchdog: {
        ...base,
        id: 'watchdog-docs-search',
        title: 'Docs search clicks',
        check: 'Search clicks on the framework pages do not drop below last week’s daily average.',
        source: null,
        sourceRequest: {
          data: 'Product analytics events from the docs site',
          evidence: '`src/analytics.ts` sends `docs_search_click` to PostHog.',
          suggestions: ['PostHog’s official MCP server', 'Composio’s PostHog toolkit'],
        },
        firstCheckMinutes: 30,
        maxGapMinutes: 12 * 60,
        forMinutes: 48 * 60,
        startsOn: 'merge',
        productionCheck: null,
        status: 'needs_source',
        startedAt: null,
        endsAt: null,
        nextCheckAt: null,
        checks: [],
        endedAt: null,
      },
    },
  ];
}

function listPersonalTasks({ paywall, kanna, prints }: SeedRepos, worktrees: SeedWorktrees): SeedTask[] {
  const defaultsPath = worktrees.defaults;
  const defaultsFile = 'src/shared/defaults.ts';
  const defaultsTestFile = 'src/shared/defaults.test.ts';
  const usageFile = 'src/shared/usage.ts';
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
      extra: [{ type: 'task.snooze_changed', taskId: 'task-usage-defaults', snoozed: true }],
      verification: [createPlanCheck('Model defaults', 'bun test src/shared/defaults.test.ts', [1, 2, 3])],
      worktreePath: defaultsPath,
      report: {
        headline: 'New chats default to a cheaper model once 85% of the usage window is spent.',
        sections: [
          {
            title: 'Read the usage window',
            summary: 'A UsageWindow type carries how much is used, the limit and when it resets.',
            spots: [
              spot(usageFile, USAGE_NEW, 'export interface UsageWindow', 'resetsAt: number;', 'normal', {
                title: 'The usage window',
                why: 'Claude reports tokens and Codex reports requests; the ratio only holds when `used` and `limit` come from the same report.',
                explain:
                  'The shape both providers’ usage reports are mapped into. `resetsAt` is a timestamp in milliseconds; nothing in this change reads it yet.',
              }),
            ],
          },
          {
            title: 'Choose the model from usage',
            summary: 'resolveDefaultModel takes the usage window and falls back above 85%.',
            spots: [
              spot(
                defaultsFile,
                DEFAULTS_NEW,
                'export function resolveDefaultModel',
                'return resolveFallbackModel(provider);',
                'high',
                {
                  title: 'Fall back past the threshold',
                  why: 'A missing usage window keeps the preferred model, so accounts without usage data never fall back.',
                  explain:
                    'The preferred model stays unless there is a window and its used share has reached `FALLBACK_THRESHOLD`. The comparison is a ratio, so it works for any unit as long as both sides share it.',
                }
              ),
              spot(
                defaultsFile,
                DEFAULTS_NEW,
                'function resolveFallbackModel',
                "return 'gpt-6-mini';",
                'normal',
                {
                  title: 'One cheaper model per provider',
                  why: 'A new provider makes this switch fail to type-check until it gets a fallback, which is intended.',
                  explain:
                    'Each provider has one fallback: Sonnet for Claude and the mini model for Codex. The switch is exhaustive over `Provider`.',
                }
              ),
            ],
          },
          {
            title: 'Test the threshold',
            summary: 'Three tests around 85% and the missing window.',
            spots: [
              spot(
                defaultsTestFile,
                DEFAULTS_TEST_NEW,
                "it('falls back at 85% of the window'",
                "toBe('gpt-6-mini');",
                'normal',
                {
                  title: 'The boundary itself',
                  why: 'Exactly 85% falls back; the comparison is `<`, so the threshold is inclusive.',
                  explain: 'Checks both providers at exactly 85 of 100, where the fallback starts.',
                }
              ),
              spot(
                defaultsTestFile,
                DEFAULTS_TEST_NEW,
                "it('keeps the preferred model without usage data'",
                "expect(resolveDefaultModel('claude', null))",
                'normal',
                {
                  title: 'No usage data',
                  why: 'Covers `null`, not a window with a limit of 0.',
                  explain: 'An account whose provider reports no usage keeps the preferred model.',
                }
              ),
            ],
          },
        ],
        judgementCalls: [
          {
            title: 'Fall back at 85%',
            call: 'Threshold at 85%',
            reason: 'Leaves room to finish a long turn on the preferred model.',
            file: defaultsFile,
            ...rangeOf(DEFAULTS_NEW, 'const FALLBACK_THRESHOLD', 'const FALLBACK_THRESHOLD'),
            alternatives: [
              {
                option: '95%',
                rejected:
                  'A long agent turn started at 94% can use the rest of the window and stop halfway through an edit.',
              },
              {
                option: 'A setting for the threshold',
                rejected:
                  'One more setting for a number few people would change; it can become one if someone asks.',
              },
            ],
          },
          {
            title: 'Only new chats switch model',
            call: 'Only new chats change model',
            reason:
              'Switching a running chat mid-conversation drops the provider’s prompt cache and changes its behaviour halfway through a task.',
            file: defaultsFile,
            ...rangeOf(
              DEFAULTS_NEW,
              'export function resolveDefaultModel',
              'const preferred = resolvePreferredModel'
            ),
            alternatives: [
              {
                option: 'Switch running chats too',
                rejected:
                  'Saves more of the window, but the next turn reruns the whole context uncached on a model that did not start the work.',
              },
            ],
          },
          {
            title: 'A fixed fallback per provider',
            call: 'A fixed fallback per provider in code',
            reason: 'Each provider has exactly one cheaper model that handles agent work well enough.',
            file: defaultsFile,
            ...rangeOf(DEFAULTS_NEW, 'function resolveFallbackModel', "return 'gpt-6-mini';"),
            alternatives: [
              {
                option: 'Let you pick the fallback in settings',
                rejected: 'A picker for a list of one per provider; worth it once there is a real choice.',
              },
            ],
          },
        ],
        walkthrough: {
          approach:
            'Kanna picks a default model when a chat starts. `resolveDefaultModel` now also takes the provider’s current usage window: below 85% it returns the preferred model as before, at 85% or more it returns that provider’s cheaper model.\n\nThe usage window is a small new type in `usage.ts`, filled by the provider adapters. The model choice stays in `defaults.ts` as two switches, one for the preferred model and one for the fallback.',
          flow: '1. Starting a chat calls `resolveDefaultModel(provider, usage)` with the latest window, or `null` when the provider reports none.\n2. With no window, the preferred model is returned.\n3. Otherwise `used / limit` is compared with `FALLBACK_THRESHOLD` (0.85).\n4. Below it, the preferred model; at or above it, `resolveFallbackModel`.\n5. A running chat keeps its model; only the next new chat sees the change.\n\n```text\nnew chat ──▶ resolveDefaultModel(provider, usage)\n             │\n             ├─ no usage window ─────▶ the preferred model\n             │\n             ├─ used / limit < 0.85 ─▶ the preferred model\n             │\n             └─ used / limit ≥ 0.85 ─▶ resolveFallbackModel\n                                       sonnet for Claude, mini for Codex\n\nrunning chat ──▶ keeps its model; only the next new chat changes\n```',
          risks: [
            {
              title: 'A zero limit divides by zero',
              risk: 'A window with a limit of 0 divides by zero: `0 / 0` is `NaN`, which fails the `<` check, so the fallback is picked for an account with no limit at all.',
              file: defaultsFile,
              ...rangeOf(
                DEFAULTS_NEW,
                'if (!usage || usage.used / usage.limit',
                'if (!usage || usage.used / usage.limit'
              ),
            },
            {
              title: 'Imminent resets are ignored',
              risk: 'The choice ignores `resetsAt`: a window at 90% that resets in two minutes still starts the chat on the cheaper model.',
              file: usageFile,
              ...rangeOf(USAGE_NEW, 'resetsAt: number;', 'resetsAt: number;'),
            },
            {
              title: 'No usage, no fallback',
              risk: 'Accounts whose provider reports no usage never fall back, however close they are to the limit.',
              file: defaultsFile,
              ...rangeOf(
                DEFAULTS_NEW,
                'if (!usage || usage.used / usage.limit',
                'if (!usage || usage.used / usage.limit'
              ),
            },
          ],
          testing: {
            automated: [
              '`defaults.test.ts` covers 84% (preferred), exactly 85% for both providers (fallback) and no usage data (preferred).',
            ],
            manual: [
              {
                action:
                  'Start Kanna from the worktree with a Claude account whose usage window is above 85%.',
                target: { kind: 'command', value: 'bun run dev' },
                expect: 'The client serves on port 5174 and the usage meter shows the window above 85%.',
              },
              {
                action: 'Start a new chat.',
                target: { kind: 'url', value: 'http://localhost:5174/' },
                expect: 'The model picker shows Sonnet instead of Opus.',
              },
              {
                action: 'Go back to a chat that was already open before the window passed 85%.',
                target: null,
                expect: 'It keeps Opus; only new chats change.',
              },
              {
                action: 'Switch to an account whose provider reports no usage and start a chat.',
                target: null,
                expect: 'The preferred model, however much of the window is used.',
              },
              {
                action: 'Read the threshold check, including what a limit of 0 does.',
                target: {
                  kind: 'file',
                  value: `${defaultsFile}:${lineOf(DEFAULTS_NEW, 'if (!usage || usage.used / usage.limit')}`,
                },
                expect: 'A limit of 0 gives `NaN` and falls back, the first risk above.',
              },
            ],
          },
        },
      },
      provider: 'codex',
      runs: [{ role: 'agent', purpose: 'build', minutes: 11, summary: 'Added the fallback.' }],
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
      ticked: ['Update the dark mode screenshots in the help center'],
      report: {
        headline: 'Hint text, borders and disabled labels read clearly in dark settings.',
        sections: [
          {
            title: 'Raise the muted tokens in dark mode',
            summary:
              'The dark theme’s muted text and border tokens move up so hint text passes 4.5:1 on the panel. Light mode keeps its values.',
            spots: [],
          },
          {
            title: 'Raise the disabled labels',
            summary: 'Disabled rows use a lighter grey in dark mode: dimmer than the rest, but readable.',
            spots: [],
          },
        ],
        judgementCalls: [],
        walkthrough: {
          approach:
            'Only the dark theme’s tokens change, so every screen that reads them improves at once and light mode is untouched.',
          flow: 'The settings page reads `--muted`, `--border` and `--disabled` from the theme; nothing else changes.',
          risks: [],
          testing: {
            automated: ['No new tests: the change is three colour tokens in the dark theme.'],
            manual: [
              {
                action: 'Open Appearance in dark mode.',
                target: { kind: 'screen', value: 'Settings → Appearance' },
                expect:
                  'The hint under each setting reads at a glance, and disabled rows are dimmer but readable.',
              },
              {
                action: 'Switch to light mode on the same screen.',
                target: null,
                expect: 'Nothing moves or changes colour.',
              },
              {
                action: 'Read the dark theme block to see which tokens moved.',
                target: { kind: 'file', value: 'src/client/theme.css' },
                expect: 'Only `--muted`, `--border` and `--disabled` change, and only under the dark theme.',
              },
            ],
          },
          steps: [
            {
              when: 'post_merge',
              kind: 'deploy',
              title: 'Purge the CDN cache for the settings stylesheet',
              detail:
                'Cloudflare keeps `settings.css` for a day, so dark mode shows the old contrast until it is purged. The token is in 1Password under Cloudflare.',
              command:
                'curl -X POST "https://api.cloudflare.com/client/v4/zones/$CF_ZONE_ID/purge_cache" -H "Authorization: Bearer $CF_API_TOKEN" --data \'{"files":["https://app.superwall.com/assets/settings.css"]}\'',
            },
            {
              when: 'post_merge',
              kind: 'other',
              title: 'Update the dark mode screenshots in the help center',
              detail:
                'The Appearance article shows the old greys. Take them in Settings → Appearance at 1280 wide.',
              command: null,
            },
          ],
        },
      },
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
    {
      id: 'task-duplicate-currency',
      request: 'paywall should show euros for german users, not dollars',
      title: 'Show euro prices on the paywall in Germany',
      repo: paywall,
      size: 'small',
      stage: 'cancelled',
      reason: 'duplicate of “Show paywall prices in the visitor’s currency”',
      branch: 'fix/paywall-euro-prices',
      ageHours: 1,
      extra: [
        {
          type: 'task.duplicated',
          taskId: 'task-duplicate-currency',
          duplicate: {
            of: 'task-paywall-euro-prices',
            by: 'shinsa',
            why: 'Both show paywall prices in the store’s currency for the visitor’s region.',
          },
        },
      ],
    },
    {
      id: 'task-closed-spinner',
      request: 'let paywalls hide the native purchase spinner',
      title: 'Hide the native purchase spinner',
      repo: paywall,
      size: 'small',
      stage: 'cancelled',
      reason: 'pull request closed',
      branch: 'feat/hide-purchase-spinner',
      ageHours: 2,
      summary: 'Paywalls can hide the native purchase spinner and show their own loading state.',
      report: {
        headline: 'A paywall option hides the native purchase spinner.',
        sections: [
          {
            title: 'Document and test the option',
            summary: 'Documented the option and tested both values.',
            spots: [],
          },
          { title: 'Changelog and lint', summary: 'Added the changelog entry.', spots: [] },
        ],
        judgementCalls: [],
      },
      runs: [
        { role: 'agent', purpose: 'build', minutes: 9, summary: 'Documented and tested the option.' },
        { role: 'reviewer', minutes: 2, summary: 'No findings.' },
      ],
      pullRequest: { number: 4575, checks: 'passing' },
      extra: [
        {
          type: 'task.staged',
          taskId: 'task-closed-spinner',
          stage: 'awaiting_merge',
          reason: 'ready to merge',
        },
      ],
    },
    {
      id: 'task-cancelled-export',
      request: 'export paywall analytics as CSV',
      title: 'Export paywall analytics as CSV',
      repo: paywall,
      size: 'large',
      stage: 'cancelled',
      reason: 'cancelled by you',
      branch: 'feat/analytics-csv-export',
      ageHours: 3,
      runs: [{ role: 'agent', purpose: 'build', minutes: 6, summary: 'Built the first phase.' }],
      extra: [
        { type: 'phase.updated', taskId: 'task-cancelled-export', index: 0, status: 'done' },
        { type: 'task.staged', taskId: 'task-cancelled-export', stage: 'building', reason: 'building' },
      ],
    },
  ];
}

function listMergeStepTasks({ paywall, kanna }: Pick<SeedRepos, 'paywall' | 'kanna'>): SeedTask[] {
  return [
    {
      id: 'task-key-rotation',
      request: 'let customers rotate their API key without downtime',
      title: 'Rotate API keys without downtime',
      repo: paywall,
      size: 'large',
      stage: 'awaiting_merge',
      reason: 'ready to merge',
      branch: 'feat/api-key-rotation',
      ageHours: 7,
      verification: [createPlanCheck('Both keys during the overlap', 'bun test src/api/keys', [1, 2, 3, 4])],
      checkResults: {
        r1: {
          outcome: 'fail',
          detail: 'src/legacy/banner.ts: 2 errors. The same command fails on main.',
          note: 'fails_on_base',
        },
      },
      summary: 'A rotated API key keeps working for 24 hours next to the new one.',
      report: {
        headline:
          'Rotating an API key keeps the old one working for 24 hours, so customers swap it without downtime.',
        sections: [
          {
            title: 'Accept the previous key for a day',
            summary:
              'The key check accepts the current key or, until it expires, the previous one, hashed with the same pepper.',
            spots: [],
          },
          {
            title: 'Rotate from the dashboard',
            summary:
              'Settings → API keys has Rotate, which shows the new key once and when the old one stops working.',
            spots: [],
          },
        ],
        judgementCalls: [],
        walkthrough: {
          approach:
            'The previous key is kept as a hash with an expiry next to the current one, so the one key check covers every route.',
          flow: '1. Rotate stores the current hash as the previous one with a 24 hour expiry.\n2. A request’s key is checked against the current hash, then the previous one while it lasts.\n3. After the expiry the previous hash is cleared on the next check.',
          risks: [],
          testing: {
            automated: [
              '`api-keys/rotate.test.ts` covers both keys working after a rotation and the old one failing after 24 hours.',
            ],
            manual: [
              {
                action: 'Rotate the key from the dashboard.',
                target: { kind: 'url', value: 'http://localhost:5173/settings/api-keys' },
                expect: 'The new key shows once, with “The old key works until …” under it.',
              },
              {
                action: 'Call the API with the old key.',
                target: {
                  kind: 'command',
                  value: 'curl -H "Authorization: Bearer $OLD_KEY" http://localhost:8787/v1/paywalls',
                },
                expect: 'It returns 200; with a made-up key it returns 401.',
              },
            ],
          },
          steps: [
            {
              when: 'pre_merge',
              kind: 'secret',
              title: 'Create `API_KEY_PEPPER` in production',
              detail:
                'Both hashes use it. Generate 32 random bytes and add it to the API service in Railway; never reuse staging’s.',
              command:
                'railway variables --service api --environment production --set API_KEY_PEPPER=$(openssl rand -hex 32)',
            },
            {
              when: 'pre_merge',
              kind: 'migration',
              title: 'Run the `api_keys_previous` migration',
              detail:
                'It adds the previous hash and its expiry. It is additive, so it is safe before the code ships.',
              command: 'bun run --cwd apps/api db:migrate',
            },
            {
              when: 'post_merge',
              kind: 'other',
              title: 'Announce key rotation in the changelog',
              detail: 'Link the API keys guide so customers know the old key keeps working for a day.',
              command: null,
            },
          ],
        },
      },
      runs: [
        {
          role: 'agent',
          purpose: 'build',
          minutes: 12,
          summary: 'Kept the previous key for a day.',
        },
        { role: 'reviewer', minutes: 3, summary: 'No findings.' },
      ],
      pullRequest: { number: 4548, checks: 'passing' },
      ticked: ['Create `API_KEY_PEPPER` in production', 'Run the `api_keys_previous` migration'],
      extra: listKeyRotationIterations(),
      gate: {
        type: 'merge',
        title: 'Merge #4548',
        body: 'Checks are green and both pre-merge steps are ticked.',
      },
    },
    {
      id: 'task-session-timeout',
      request: 'log people out after 12 hours idle',
      title: 'Log out after 12 idle hours',
      repo: kanna,
      size: 'small',
      stage: 'merged',
      reason: 'merged',
      branch: 'feat/idle-timeout',
      ageHours: 30,
      pullRequest: { number: 219, checks: 'passing', mergeCommit: '4be1a07' },
      merged: true,
      summary: 'Sessions end after 12 hours without activity.',
      report: {
        headline: 'Sessions end after 12 hours without activity, configurable per workspace.',
        sections: [
          {
            title: 'Expire idle sessions',
            summary:
              'The session store records the last request and refuses a session idle for longer than the limit.',
            spots: [],
          },
        ],
        judgementCalls: [],
        walkthrough: {
          approach: 'The limit lives in the session store, so every route is covered by one check.',
          flow: 'Each request touches the session; a session idle past `SESSION_IDLE_HOURS` is refused and the user signs in again.',
          risks: [],
          testing: {
            automated: ['`session-store.test.ts` covers the idle limit and the default of 12 hours.'],
            manual: [
              {
                action: 'Start the app with a one-minute limit and wait a minute.',
                target: { kind: 'command', value: 'SESSION_IDLE_HOURS=0.0167 bun run dev' },
                expect: 'The next click lands on the sign-in page.',
              },
            ],
          },
          steps: [
            {
              when: 'post_merge',
              kind: 'env',
              title: 'Set `SESSION_IDLE_HOURS=12` in production',
              detail: 'The default is 12 already; setting it makes the value visible to on-call.',
              command: 'fly secrets set SESSION_IDLE_HOURS=12 --app kanna',
            },
            {
              when: 'post_merge',
              kind: 'deploy',
              title: 'Restart the web workers',
              detail: 'Workers read the variable on start.',
              command: 'fly apps restart kanna',
            },
          ],
        },
      },
      runs: [
        { role: 'agent', purpose: 'build', minutes: 5, summary: 'Added the idle limit.' },
        { role: 'reviewer', minutes: 2, summary: 'No findings.' },
      ],
      ticked: ['Set `SESSION_IDLE_HOURS=12` in production', 'Restart the web workers'],
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
    ...listProcessTasks({ paywall, kanna }, worktrees.exportBackoff),
    ...listShapeTasks({ paywall, kanna }),
    ...listDelegationTasks({ paywall }),
    ...listTriggerTasks({ paywall, kanna }),
    ...listRoundTasks({ paywall }, worktrees.rounds),
    ...listMergeStepTasks({ paywall, kanna }),
    ...listHistoryTasks(paywall),
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
  log.writeBriefing(null, {
    at: NOW - 3 * MINUTE,
    text: 'Start with “Run the embedded chat on MCP v2”: it is ready for review, and the tool calls work waits on it. Then “Refuse to duplicate code-first paywalls” and “Rewrite the framework command registry”.',
    briefing: {
      now: {
        taskId: 'task-embedded-chat',
        why: 'Built and checked, and “Let the embedded chat call paywall tools” waits on it, so reviewing it first frees that work',
      },
      next: [
        { taskId: 'task-duplicate', why: 'Pull request #4531 is clean and ready to merge' },
        {
          taskId: 'task-command-registry',
          why: 'The rewrite is built, and the agent review found two blocking problems in the flag parser',
        },
      ],
      running: 'Agents are working on the remaining tasks.',
      note: null,
    },
  });
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
  writeSeedEvidence(DATA);
  writeAccountTranscripts(transcripts);
  const session = Bun.env.SHINSA_SEED_SESSION;
  if (session) writeSessionTranscript(session, runTimes, transcripts);
  console.info(`Seeded ${tasks.length} tasks into ${DATA}`);
  console.info(
    `Run: SHINSA_DATA_DIR=${DATA} SHINSA_INSPECT=1 SHINSA_PORT=5190 bun run --cwd apps/engine start`
  );
}

seed();
