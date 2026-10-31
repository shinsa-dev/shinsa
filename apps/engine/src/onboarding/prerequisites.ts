import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { type CommandResult, runCommand } from '../shell/index.ts';

export type CommandRunner = (
  command: string[],
  cwd: string,
  options?: { timeoutMs?: number }
) => Promise<CommandResult>;

type PrerequisiteId = 'git' | 'brew' | 'gh' | 'gh_auth' | 'claude' | 'bun' | 'codex' | 'codex_auth';

interface Prerequisite {
  id: PrerequisiteId;
  label: string;
  ok: boolean;
  detail: string;
  fix: string | null;
  command: string | null;
  optional?: boolean;
}

export interface PrerequisiteReport {
  ready: boolean;
  checks: Prerequisite[];
}

export interface PrerequisiteNeeds {
  bun: boolean;
}

const CHECK_TIMEOUT_MS = 15_000;

const NOT_FOUND_CODE = 127;

const BUN_FILES = ['bun.lock', 'bun.lockb', 'bunfig.toml'];

const FIXES: Record<PrerequisiteId, string> = {
  git: 'Install Apple’s command line tools, which include Git.',
  brew: 'Install Homebrew, which installs the GitHub CLI.',
  gh: 'Install the GitHub CLI with Homebrew.',
  gh_auth: 'Sign in to GitHub, so Shinsa can open and merge pull requests.',
  claude: 'Install Claude Code, which agents run on.',
  bun: 'Your repositories use Bun. Install it so agents can run their checks.',
  codex: 'Only for agents you run on Codex.',
  codex_auth: 'Only for agents you run on Codex.',
};

const OPTIONAL_BUN_FIX = 'Only for repositories that use Bun.';

const COMMANDS: Record<PrerequisiteId, string> = {
  git: 'xcode-select --install',
  brew: '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"',
  gh: 'brew install gh',
  gh_auth: 'gh auth login',
  claude: 'curl -fsSL https://claude.ai/install.sh | bash',
  bun: 'curl -fsSL https://bun.sh/install | bash',
  codex: 'npm install -g @openai/codex',
  codex_auth: 'codex login',
};

const LABELS: Record<PrerequisiteId, string> = {
  git: 'Git',
  brew: 'Homebrew',
  gh: 'GitHub CLI',
  gh_auth: 'Signed in to GitHub',
  claude: 'Claude Code',
  bun: 'Bun',
  codex: 'Codex',
  codex_auth: 'Signed in to Codex',
};

export function resolveInstallCommand(id: string) {
  return Object.hasOwn(COMMANDS, id) ? COMMANDS[id as PrerequisiteId] : null;
}

export function resolvePrerequisiteLabel(id: string) {
  return Object.hasOwn(LABELS, id) ? LABELS[id as PrerequisiteId] : null;
}

function listFolders(root: string) {
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .map((entry) => join(root, entry.name));
  } catch {
    return [];
  }
}

export function isBunUsed(roots: readonly string[]) {
  return roots
    .flatMap((root) => [root, ...listFolders(root)])
    .some((folder) => BUN_FILES.some((file) => existsSync(join(folder, file))));
}

function firstLine(text: string) {
  return text.split('\n')[0]?.trim() ?? '';
}

function describeOutcome(result: CommandResult) {
  if (result.ok) return firstLine(result.stdout || result.stderr);
  if (result.timedOut) return 'It did not answer in time.';
  if (result.code === NOT_FOUND_CODE) return 'Not installed.';
  return firstLine(result.stderr || result.stdout) || `It exited with code ${result.code}.`;
}

function createCheck(
  id: PrerequisiteId,
  ok: boolean,
  detail: string,
  optional: boolean,
  fix = FIXES[id]
): Prerequisite {
  return {
    id,
    label: LABELS[id],
    ok,
    detail,
    fix: ok ? null : fix,
    command: ok ? null : COMMANDS[id],
    ...(optional ? { optional: true } : {}),
  };
}

function readGithubLogin(result: CommandResult) {
  if (!result.ok) return describeOutcome(result);
  const account = /Logged in to \S+ account (\S+)/.exec(`${result.stdout}\n${result.stderr}`)?.[1];
  return account ? `Signed in as ${account}.` : 'Signed in.';
}

function listBrewDependents(checks: Prerequisite[]) {
  return checks.filter((check) => check.command?.startsWith('brew '));
}

export async function resolvePrerequisites(
  cwd: string,
  run: CommandRunner = runCommand,
  needs: PrerequisiteNeeds = { bun: true }
): Promise<PrerequisiteReport> {
  const ask = (command: string[]) => run(command, cwd, { timeoutMs: CHECK_TIMEOUT_MS });
  const [git, brew, gh, ghAuth, claude, bun, codex, codexAuth] = await Promise.all([
    ask(['git', '--version']),
    ask(['brew', '--version']),
    ask(['gh', '--version']),
    ask(['gh', 'auth', 'status']),
    ask(['claude', '--version']),
    ask(['bun', '--version']),
    ask(['codex', '--version']),
    ask(['codex', 'login', 'status']),
  ]);
  const tools = [
    createCheck('gh', gh.ok, describeOutcome(gh), false),
    createCheck(
      'gh_auth',
      gh.ok && ghAuth.ok,
      gh.ok ? readGithubLogin(ghAuth) : 'The GitHub CLI is missing.',
      false
    ),
    createCheck('claude', claude.ok, describeOutcome(claude), false),
    createCheck('bun', bun.ok, describeOutcome(bun), !needs.bun, needs.bun ? FIXES.bun : OPTIONAL_BUN_FIX),
    createCheck('codex', codex.ok, describeOutcome(codex), true),
    createCheck(
      'codex_auth',
      codex.ok && codexAuth.ok,
      codex.ok ? describeOutcome(codexAuth) : 'Codex is missing.',
      true
    ),
  ];
  const brewFor = listBrewDependents(tools);
  const checks = [
    createCheck('git', git.ok, describeOutcome(git), false),
    ...(brewFor.length > 0
      ? [
          createCheck(
            'brew',
            brew.ok,
            describeOutcome(brew),
            brewFor.every((check) => check.optional === true)
          ),
        ]
      : []),
    ...tools,
  ];
  return { ready: checks.every((check) => check.ok || check.optional === true), checks };
}
