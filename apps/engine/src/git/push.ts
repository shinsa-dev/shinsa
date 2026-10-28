import { existsSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { redactSecrets } from '../log/index.ts';
import { type CommandResult, describeFailure, runCommand } from '../shell/index.ts';
import { assertRefName } from './refs.ts';

export type PushFailureKind = 'hook' | 'network' | 'non_fast_forward' | 'other';

const REJECTED = /^\s*!\s+\[rejected\].*\((?:non-fast-forward|fetch first|stale info)\)/m;

const REMOTE_REJECTED = /^\s*!\s+\[remote rejected\]/m;

const GIT_LINE = /^(?:fatal:|ssh:|send-pack:|error: RPC failed)/;

const NETWORK =
  /could not resolve host|unable to access '|could not read from remote repository|failed to connect to|connection timed out|connection refused|connection reset by peer|network is unreachable|the remote end hung up unexpectedly|rpc failed|the requested url returned error: (?:5\d\d|429)|authentication failed for|permission denied \(publickey|ssh: connect to host|temporary failure in name resolution|ssl certificate problem|operation timed out/i;

const HOOK_FAILED = /husky - pre-push|pre-push (?:hook|script) (?:failed|declined)|\bhooks? failed\b/i;

const PUSH_FAILED = /failed to push some refs/;

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');

const DETAIL_LIMIT = 160;

const TAIL_LINES = 80;

const TAIL_CHARS = 6_000;

const SUMMARY: Record<Exclude<PushFailureKind, 'network' | 'other'>, string> = {
  hook: 'the pre-push hook failed',
  non_fast_forward: 'the branch on the remote has commits this branch does not have',
};

export class PushError extends Error {
  readonly kind: PushFailureKind;
  readonly detail: string;
  readonly output: string;

  constructor(kind: PushFailureKind, message: string, output: string) {
    super(message);
    this.kind = kind;
    this.output = output;
    this.detail =
      kind === 'hook' || kind === 'non_fast_forward' ? SUMMARY[kind] : describeShortFailure(message);
  }
}

function listLines(output: string) {
  return output
    .replace(ANSI, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function selectNetworkLine(output: string) {
  return listLines(output).find((line) => GIT_LINE.test(line) && NETWORK.test(line)) ?? null;
}

export function classifyPushFailure(output: string, hook: boolean): PushFailureKind {
  if (REJECTED.test(output)) return 'non_fast_forward';
  if (REMOTE_REJECTED.test(output)) return 'other';
  if (selectNetworkLine(output)) return 'network';
  if (hook && (HOOK_FAILED.test(output) || PUSH_FAILED.test(output))) return 'hook';
  return 'other';
}

export function describeShortFailure(text: string) {
  const output = text.replace(/^[^:\n]* failed: /, '');
  const line =
    selectNetworkLine(output) ??
    listLines(output).find((candidate) => !candidate.startsWith('hint:')) ??
    'it failed with no output';
  const short = line.replace(/^(?:fatal|error): /, '').replace(/^unable to access '[^']*': /, '');
  return short.length > DETAIL_LIMIT ? `${short.slice(0, DETAIL_LIMIT - 1)}…` : short;
}

export function resolveOutputTail(output: string) {
  const tail = output.replace(ANSI, '').trimEnd().split(/\r?\n/).slice(-TAIL_LINES).join('\n');
  return tail.length > TAIL_CHARS ? `…${tail.slice(-TAIL_CHARS)}` : tail;
}

function isExecutable(path: string) {
  return existsSync(path) && (statSync(path).mode & 0o111) !== 0;
}

export async function hasPrePushHook(cwd: string, signal?: AbortSignal) {
  const result = await runCommand(['git', 'rev-parse', '--git-path', 'hooks/pre-push'], cwd, { signal });
  if (!result.ok) return false;
  const path = resolve(cwd, result.stdout);
  if (!isExecutable(path)) return false;
  const folder = dirname(path);
  return basename(folder) !== '_' || existsSync(join(dirname(folder), 'pre-push'));
}

export function createPushError(command: string[], result: CommandResult, hook: boolean) {
  const output = redactSecrets([result.stdout, result.stderr].filter(Boolean).join('\n'));
  const kind = result.timedOut ? 'network' : classifyPushFailure(output, hook);
  return new PushError(kind, describeFailure(command, result), output);
}

export async function runPush(command: string[], cwd: string, signal?: AbortSignal) {
  const result = await runCommand(command, cwd, { timeoutMs: null, signal });
  if (result.ok) return;
  throw createPushError(command, result, await hasPrePushHook(cwd));
}

export async function pushBranch(path: string, branch: string, signal?: AbortSignal) {
  const ref = `HEAD:refs/heads/${assertRefName(branch)}`;
  await runPush(['git', 'push', '--quiet', '-u', 'origin', ref], path, signal);
}
