import type { TaskPriority } from '@shinsa/core';
import { describeVersion, type ServerHealth } from '../instance/index.ts';
import { type CommandReceipt, describeQueue, describeUptime, QUEUE_EMPTY } from '../surface/index.ts';
import {
  type Display,
  describeFields,
  describeInline,
  describeMark,
  describeParagraph,
  shortenHome,
} from '../terminal/index.ts';
import type { ApiClient } from './api.ts';
import { isPathArgument, resolveHomeLink, resolvePathArgument, resolveTaskLink } from './app.ts';
import { readHealth } from './engine.ts';
import { describeSession, readSession } from './session.ts';

export interface CommandIo {
  api: ApiClient;
  display: Display;
  home: string | undefined;
  cwd: string;
  write: (line?: string) => void;
  openApp: (link: string) => Promise<void>;
  readRepoRoot: (dir: string) => Promise<string | null>;
  projectsDir?: string;
}

interface ParsedArgs {
  flags: Set<string>;
  values: Map<string, string>;
  positional: string[];
}

const VALUE_FLAGS = new Set(['--in', '--lines']);

export function parseArgs(args: string[]): ParsedArgs {
  const parsed: ParsedArgs = { flags: new Set(), values: new Map(), positional: [] };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? '';
    if (VALUE_FLAGS.has(arg)) {
      const value = args[index + 1];
      if (!value) throw new Error(`${arg} needs a value.`);
      parsed.values.set(arg, value);
      index += 1;
    } else if (arg.startsWith('--')) {
      parsed.flags.add(arg);
    } else {
      parsed.positional.push(arg);
    }
  }
  return parsed;
}

function resolvePriority(flags: Set<string>): TaskPriority {
  if (flags.has('--urgent')) return 'urgent';
  if (flags.has('--high')) return 'high';
  return 'normal';
}

function writeTaskLink(io: CommandIo, receipt: CommandReceipt) {
  const ref = receipt.handle ?? receipt.taskId;
  if (ref) io.write(io.display.style.dim(`${io.api.base}/tasks/${ref}`));
}

function writeDone(io: CommandIo, text: string) {
  io.write(describeMark(io.display.style, 'success', 'check', text));
}

export async function createTask(args: string[], io: CommandIo) {
  const { flags, positional } = parseArgs(args);
  const request = positional.join(' ').trim();
  if (!request)
    throw new Error('Say what should be done, such as `shinsa do "fix the scroll in tab groups"`.');
  const result = await io.api.sendCommand({
    type: 'task.create',
    request,
    repoId: null,
    priority: resolvePriority(flags),
    planFirst: flags.has('--plan-first'),
    ...(flags.has('--backlog') ? { backlog: true } : {}),
    origin: io.cwd,
  });
  writeDone(
    io,
    flags.has('--backlog')
      ? 'Added to the backlog. It plans now and builds when you start it.'
      : 'Started. Shinsa brings it back when it needs a decision.'
  );
  writeTaskLink(io, result);
}

export async function importSession(args: string[], io: CommandIo) {
  const { flags, values, positional } = parseArgs(args);
  const [target] = positional;
  if (!target) throw new Error('Name the session by its file or id, such as `shinsa import 0b9c2f4e-6a8d`.');
  const session = readSession(target, io.projectsDir);
  const result = await io.api.sendCommand({
    type: 'task.create',
    request: describeSession(session),
    repoId: null,
    priority: resolvePriority(flags),
    planFirst: true,
    origin: values.get('--in') ?? session.cwd ?? io.cwd,
  });
  writeDone(io, `Imported ${shortenHome(session.path, io.home)}`);
  io.write('It starts with a plan for you to approve, so nothing builds until you have looked.');
  writeTaskLink(io, result);
}

function describeDamage(count: number) {
  return count === 1
    ? 'It skipped 1 damaged entry in its log at start. `shinsa health` shows it.'
    : `It skipped ${count} damaged entries in its log at start. \`shinsa health\` lists them.`;
}

function describeStopped(display: Display) {
  const { style } = display;
  return [
    describeMark(style, 'danger', 'dot', `${style.bold('Stopped')}  The engine is not running.`),
    ...describeParagraph(
      display,
      '`shinsa start` starts it, and so does opening the Shinsa app.',
      style.symbols ? 2 : 0,
      'dim'
    ),
  ];
}

function describeEngineBlock(health: ServerHealth, io: CommandIo) {
  const { display } = io;
  const { style } = display;
  const indent = style.symbols ? 2 : 0;
  return [
    describeMark(style, 'success', 'dot', `${style.bold('Running')}  Shinsa ${describeVersion(health)}`),
    ...describeFields(
      display,
      [
        ['Uptime', describeUptime(health.uptimeMs)],
        ['Address', io.api.base],
        ['Process', String(health.pid)],
        ['Engine', shortenHome(health.installPath, io.home)],
        ['Data', shortenHome(health.dataDir, io.home)],
      ],
      indent
    ),
    ...(health.ok
      ? []
      : [
          '',
          describeMark(
            style,
            'warning',
            'warning',
            describeInline(style, describeDamage(health.problems.length))
          ),
        ]),
  ];
}

export async function printStatus(args: string[], io: CommandIo) {
  const json = parseArgs(args).flags.has('--json');
  const health = await readHealth(io.api.base);
  if (!health) {
    if (json) io.write(JSON.stringify({ engine: null, queue: null }, null, 2));
    else for (const line of describeStopped(io.display)) io.write(line);
    return 1;
  }
  const summary = await io.api.readQueue();
  if (json) {
    io.write(JSON.stringify({ engine: health, queue: summary }, null, 2));
    return 0;
  }
  const queue = describeQueue(summary, io.display);
  const briefing = summary.briefing ?? (queue.length === 0 ? QUEUE_EMPTY : null);
  const lines = [
    ...describeEngineBlock(health, io),
    ...(briefing ? ['', ...describeParagraph(io.display, briefing)] : []),
    ...(queue.length > 0 ? ['', ...queue] : []),
  ];
  for (const line of lines) io.write(line);
  return 0;
}

export async function openApp(args: string[], io: CommandIo) {
  const [target] = parseArgs(args).positional;
  if (!target) return io.openApp(resolveHomeLink());
  if (!isPathArgument(target)) return io.openApp(resolveTaskLink(target));
  await focusFolder(resolvePathArgument(target, io.cwd), io);
  await io.openApp(resolveHomeLink());
}

async function focusFolder(dir: string, io: CommandIo) {
  const root = await io.readRepoRoot(dir);
  if (!root) {
    io.write(`${dir} is not in a git repository, so Shinsa opens on Home.`);
    return;
  }
  const { repos } = await io.api.readRepos();
  const repo = repos.find((entry) => entry.path === root);
  if (!repo) {
    io.write(`Shinsa has not worked in ${root} yet. Ask for something there and it joins your projects.`);
    return;
  }
  if (!repo.projectId) return;
  await io.api.sendCommand({ type: 'focus.change', projectId: repo.projectId, until: null });
}
