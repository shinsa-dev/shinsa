import { redactSecrets } from '../../log/redact.ts';
import { describeFailure } from '../../shell/failure.ts';
import type { CommandResult } from '../../shell/schema.ts';
import {
  ANSI,
  DETAIL_LIMIT,
  GIT_LINE,
  HOOK_FAILED,
  NETWORK,
  PUSH_FAILED,
  PUSH_SUMMARY,
  PushError,
  type PushFailureKind,
  REJECTED,
  REMOTE_REJECTED,
  TAIL_CHARS,
  TAIL_LINES,
} from './schema.ts';

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

export function createPushError(command: readonly string[], result: CommandResult, hook: boolean) {
  const output = redactSecrets([result.stdout, result.stderr].filter(Boolean).join('\n'));
  const kind = result.timedOut ? 'network' : classifyPushFailure(output, hook);
  const message = describeFailure(command, result);
  const detail =
    kind === 'hook' || kind === 'non_fast_forward' ? PUSH_SUMMARY[kind] : describeShortFailure(message);
  return new PushError({ kind, detail, output, message });
}

export function normalizeRemote(url: string) {
  return url
    .replace(/^git@([^:]+):/, '$1/')
    .replace(/^[a-z]+:\/\/(?:[^/@]+@)?/, '')
    .replace(/\.git$/, '');
}
