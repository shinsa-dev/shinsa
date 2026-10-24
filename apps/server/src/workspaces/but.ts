import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type CommandOptions, describeFailure, runCommand } from '../shell/index.ts';

const GITBUTLER_BRANCH = 'gitbutler/workspace';

const BUT_TIMEOUT_MS = 2 * 60 * 1000;

const BUT_MISSING = 'GitButler’s command line (`but`) is not installed or not on the PATH.';

interface ButChange {
  cliId: string;
  filePath: string;
}

interface ButStatus {
  uncommittedChanges: ButChange[];
  stacks: { branches: { name: string }[] }[];
}

export async function isButInstalled(signal?: AbortSignal) {
  const result = await runCommand(['but', '--version'], process.cwd(), { signal, timeoutMs: 10_000 });
  return result.ok;
}

function readHead(path: string) {
  const head = join(path, '.git', 'HEAD');
  if (!existsSync(head)) return null;
  return readFileSync(head, 'utf8').trim();
}

export function isGitButlerWorkspace(path: string) {
  return (
    readHead(path) === `ref: refs/heads/${GITBUTLER_BRANCH}` && existsSync(join(path, '.git', 'gitbutler'))
  );
}

export async function runBut(args: string[], cwd: string, options: CommandOptions = {}) {
  const command = ['but', ...args];
  const result = await runCommand(command, cwd, { timeoutMs: BUT_TIMEOUT_MS, ...options });
  if (result.code === 127) throw new Error(BUT_MISSING);
  if (!result.ok) throw new Error(describeFailure(command, result));
  return result.stdout;
}

export async function readButStatus(cwd: string, signal?: AbortSignal) {
  return JSON.parse(await runBut(['status', '--json'], cwd, { signal })) as ButStatus;
}

export function listAppliedBranches(status: ButStatus) {
  return status.stacks.flatMap((stack) => stack.branches.map((branch) => branch.name));
}
