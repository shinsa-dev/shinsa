import { type CommandResult, runCommand } from '../shell/index.ts';

export type CommandRunner = (
  command: string[],
  cwd: string,
  options?: { timeoutMs?: number }
) => Promise<CommandResult>;

type PrerequisiteId = 'git' | 'gh' | 'gh_auth' | 'claude' | 'claude_auth' | 'codex' | 'codex_auth' | 'bun';

interface Prerequisite {
  id: PrerequisiteId;
  label: string;
  ok: boolean;
  detail: string;
  fix: string | null;
  optional?: boolean;
}

export interface PrerequisiteReport {
  ready: boolean;
  checks: Prerequisite[];
}

const CHECK_TIMEOUT_MS = 15_000;

const FIXES: Record<PrerequisiteId, string> = {
  git: 'Install Git, for example with `xcode-select --install` or `brew install git`.',
  gh: 'Install the GitHub CLI with `brew install gh`.',
  gh_auth: 'Sign in to GitHub with `gh auth login`.',
  claude: 'Install Claude Code from https://claude.com/claude-code.',
  claude_auth: 'Sign in to Claude Code with `claude auth login`.',
  codex: 'Only for agents you run on Codex: install it with `npm install -g @openai/codex`.',
  codex_auth: 'Only for agents you run on Codex: sign in with `codex login`.',
  bun: 'Install Bun from https://bun.sh.',
};

const OPTIONAL: ReadonlySet<PrerequisiteId> = new Set(['codex', 'codex_auth']);

const LABELS: Record<PrerequisiteId, string> = {
  git: 'Git',
  gh: 'GitHub CLI',
  gh_auth: 'Signed in to GitHub',
  claude: 'Claude Code',
  claude_auth: 'Signed in to Claude',
  codex: 'Codex',
  codex_auth: 'Signed in to Codex',
  bun: 'Bun',
};

function firstLine(text: string) {
  return text.split('\n')[0]?.trim() ?? '';
}

function describeOutcome(result: CommandResult) {
  if (result.ok) return firstLine(result.stdout || result.stderr);
  if (result.timedOut) return 'It did not answer in time.';
  return firstLine(result.stderr || result.stdout) || `It exited with code ${result.code}.`;
}

function createCheck(id: PrerequisiteId, ok: boolean, detail: string): Prerequisite {
  return {
    id,
    label: LABELS[id],
    ok,
    detail,
    fix: ok ? null : FIXES[id],
    ...(OPTIONAL.has(id) ? { optional: true } : {}),
  };
}

function readGithubLogin(result: CommandResult) {
  if (!result.ok) return describeOutcome(result);
  const account = /Logged in to \S+ account (\S+)/.exec(`${result.stdout}\n${result.stderr}`)?.[1];
  return account ? `Signed in as ${account}.` : 'Signed in.';
}

function parseClaudeStatus(stdout: string) {
  try {
    return JSON.parse(stdout) as { loggedIn?: unknown; email?: unknown };
  } catch {
    return null;
  }
}

function readClaudeLogin(result: CommandResult) {
  const status = parseClaudeStatus(result.stdout);
  if (!status) return { ok: result.ok, detail: describeOutcome(result) };
  if (status.loggedIn !== true) return { ok: false, detail: 'Not signed in.' };
  const who = typeof status.email === 'string' ? status.email : 'an account';
  return { ok: true, detail: `Signed in as ${who}.` };
}

export async function resolvePrerequisites(
  cwd: string,
  run: CommandRunner = runCommand
): Promise<PrerequisiteReport> {
  const ask = (command: string[]) => run(command, cwd, { timeoutMs: CHECK_TIMEOUT_MS });
  const [git, gh, ghAuth, claude, claudeAuth, codex, codexAuth, bun] = await Promise.all([
    ask(['git', '--version']),
    ask(['gh', '--version']),
    ask(['gh', 'auth', 'status']),
    ask(['claude', '--version']),
    ask(['claude', 'auth', 'status', '--json']),
    ask(['codex', '--version']),
    ask(['codex', 'login', 'status']),
    ask(['bun', '--version']),
  ]);
  const claudeLogin = readClaudeLogin(claudeAuth);
  const checks = [
    createCheck('git', git.ok, describeOutcome(git)),
    createCheck('gh', gh.ok, describeOutcome(gh)),
    createCheck(
      'gh_auth',
      gh.ok && ghAuth.ok,
      gh.ok ? readGithubLogin(ghAuth) : 'The GitHub CLI is missing.'
    ),
    createCheck('claude', claude.ok, describeOutcome(claude)),
    createCheck(
      'claude_auth',
      claude.ok && claudeLogin.ok,
      claude.ok ? claudeLogin.detail : 'Claude Code is missing.'
    ),
    createCheck('codex', codex.ok, describeOutcome(codex)),
    createCheck(
      'codex_auth',
      codex.ok && codexAuth.ok,
      codex.ok ? describeOutcome(codexAuth) : 'Codex is missing.'
    ),
    createCheck('bun', bun.ok, describeOutcome(bun)),
  ];
  return { ready: checks.every((check) => check.ok || check.optional === true), checks };
}
