import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type CommandOptions, describeFailure, runCommand } from '../shell/index.ts';

const GITBUTLER_BRANCH = 'gitbutler/workspace';

const FIRST_VERSION_WITHOUT_SETUP = 23;

const BUT_TIMEOUT_MS = 2 * 60 * 1000;

export const BUT_MISSING = 'GitButler’s command line (`but`) is not installed or not on the PATH.';

interface ButChange {
  cliId: string;
  filePath: string;
}

interface ButBranch {
  name: string;
  commits?: { conflicted?: boolean }[];
}

interface ButStatus {
  uncommittedChanges: ButChange[];
  stacks: { branches: ButBranch[] }[];
}

export async function readButVersion(signal?: AbortSignal) {
  const result = await runCommand(['but', '--version'], process.cwd(), { signal, timeoutMs: 10_000 });
  if (!result.ok) return null;
  return result.stdout.trim().replace(/^but\s+/, '');
}

export function needsButSetup(version: string) {
  const [major, minor] = version.split('.').map(Number);
  return major === 0 && (minor ?? 0) < FIRST_VERSION_WITHOUT_SETUP;
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

export function isGitButlerReady(path: string, version: string | null) {
  if (version === null) return false;
  return !needsButSetup(version) || isGitButlerWorkspace(path);
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

export function isStackedWithOthers(status: ButStatus, name: string) {
  return status.stacks.some(
    (stack) => stack.branches.length > 1 && stack.branches.some((branch) => branch.name === name)
  );
}

export function listConflictedBranches(status: ButStatus) {
  return status.stacks
    .flatMap((stack) => stack.branches)
    .filter((branch) => branch.commits?.some((commit) => commit.conflicted === true))
    .map((branch) => branch.name);
}
