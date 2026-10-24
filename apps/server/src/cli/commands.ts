import type { TaskPriority } from '@shinsa/core';
import type { CommandReceipt } from '../surface/index.ts';
import type { ApiClient } from './api.ts';
import { describeSession, readSession } from './session.ts';

export interface CommandIo {
  api: ApiClient;
  cwd: string;
  write: (line?: string) => void;
  openUrl: (url: string) => Promise<void>;
  projectsDir?: string;
}

interface ParsedArgs {
  flags: Set<string>;
  values: Map<string, string>;
  positional: string[];
}

const VALUE_FLAGS = new Set(['--in']);

function parseArgs(args: string[]): ParsedArgs {
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
  if (ref) io.write(`${io.api.base}/tasks/${ref}`);
}

export async function createTask(args: string[], io: CommandIo) {
  const { flags, positional } = parseArgs(args);
  const intent = positional.join(' ').trim();
  if (!intent) throw new Error('Say what should be done: shinsa do "fix the scroll in tab groups"');
  const result = await io.api.sendCommand({
    type: 'task.create',
    intent,
    repoId: null,
    priority: resolvePriority(flags),
    planFirst: flags.has('--spec'),
    origin: io.cwd,
  });
  io.write('Started. Shinsa brings it back when it needs a decision.');
  writeTaskLink(io, result);
}

export async function importSession(args: string[], io: CommandIo) {
  const { flags, values, positional } = parseArgs(args);
  const [target] = positional;
  if (!target) throw new Error('Name the session: shinsa import <session.jsonl | session-id>');
  const session = readSession(target, io.projectsDir);
  const result = await io.api.sendCommand({
    type: 'task.create',
    intent: describeSession(session),
    repoId: null,
    priority: resolvePriority(flags),
    planFirst: true,
    origin: values.get('--in') ?? session.cwd ?? io.cwd,
  });
  io.write(`Imported ${session.path}`);
  io.write('It starts with a plan for you to approve, so nothing builds until you have looked.');
  writeTaskLink(io, result);
}

export async function printStatus(io: CommandIo) {
  const summary = await io.api.readQueue();
  io.write(summary.briefing ?? 'No briefing yet.');
  io.write();
  io.write(`Needs you (${summary.decisions.length})`);
  for (const entry of summary.decisions) io.write(`  ${entry.label.padEnd(9)} ${entry.title}  ${entry.url}`);
  io.write();
  io.write(`Agents working (${summary.working.length})`);
  for (const entry of summary.working) io.write(`  ${entry.label.padEnd(9)} ${entry.title}`);
}

export async function openInBrowser(args: string[], io: CommandIo) {
  const [taskId] = parseArgs(args).positional;
  const page = taskId ? `${io.api.base}/tasks/${encodeURIComponent(taskId)}` : io.api.base;
  await io.openUrl(page);
}
