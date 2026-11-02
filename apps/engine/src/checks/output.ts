import { join, relative } from 'node:path';
import type { CommandResult } from '../shell/schema.ts';
import { listFailedTests } from './reruns.ts';
import { type FailedTestGroup, type GroupRerun, OUTPUT_TAIL, SIGNAL, SIGNAL_LINES } from './schema.ts';

export function tailOutput(text: string) {
  const trimmed = text.trim();
  if (trimmed.length <= OUTPUT_TAIL) return trimmed;
  const signal = trimmed
    .split('\n')
    .filter((line) => SIGNAL.test(line))
    .slice(0, SIGNAL_LINES)
    .join('\n');
  const tail = trimmed.slice(-Math.max(1000, OUTPUT_TAIL - signal.length));
  return signal ? `${signal}\n…\n${tail}` : `…\n${tail}`;
}

export function joinOutput(result: CommandResult) {
  return [result.stdout, result.stderr].filter((part) => part.length > 0).join('\n');
}

export function describeFailedRun(result: CommandResult, output: string, timeoutMs: number) {
  const stopped = result.timedOut ? `Stopped after ${Math.round(timeoutMs / 60_000)} minutes.\n` : '';
  return `${stopped}${tailOutput(output)}`.trim() || `exit ${result.code}`;
}

function listGroupPaths(groups: readonly FailedTestGroup[], cwd: string) {
  return groups.flatMap((group) => group.files.map((file) => relative(cwd, join(group.packageDir, file))));
}

export function listFailedFiles(output: string, cwd: string) {
  const failed = listFailedTests(output, cwd);
  return failed.kind === 'files' ? listGroupPaths(failed.groups, cwd) : null;
}

export function describeRerunOutput(reruns: readonly GroupRerun[]) {
  return reruns.map((rerun) => rerun.output).join('\n');
}

export function listRerunPaths(reruns: readonly GroupRerun[], cwd: string) {
  return listGroupPaths(
    reruns.map((rerun) => rerun.group),
    cwd
  );
}
