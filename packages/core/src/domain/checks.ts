import type { ReportCheck, TaskCheck } from '../report/types.ts';
import type { Repo, Task } from './types.ts';

const WHOLE_SUITES = [
  /^(?:bun|npm|pnpm|yarn)(?: run)? test$/,
  /^(?:bunx |npx |pnpm exec |yarn )?(?:vitest(?: run)?|jest)$/,
  /^(?:python3? )?pytest$/,
  /^(?:uv run |poetry run )pytest$/,
  /^go test \.\/\.\.\.$/,
  /^cargo test$/,
  /^make (?:test|check)$/,
  /^(?:bun|npm|pnpm|yarn)(?: run)? (?:check|ci|verify|test:all)$/,
  /^(?:bunx |npx |pnpm exec |yarn )?turbo(?: run)? (?:test|check|ci|verify|test:all)$/,
];

const SEGMENT_SEPARATOR = /\$\(|`|&&|\|\||[;|\n]|(?<![<>])&(?!>)/;

const FLAG = /^-/;

const DURATION = /^(?:-|\d+(?:\.\d+)?[a-z]?$|[A-Z]+$)/;

const WRAPPERS: ReadonlyMap<string, RegExp> = new Map([
  ['env', FLAG],
  ['timeout', DURATION],
  ['gtimeout', DURATION],
  ['nice', /^(?:-|\d+$)/],
  ['nohup', FLAG],
  ['time', FLAG],
  ['command', FLAG],
  ['exec', FLAG],
  ['sh', FLAG],
  ['bash', FLAG],
  ['zsh', FLAG],
]);

const VALUED_OPTIONS = new Set([
  '--cwd',
  '--filter',
  '-C',
  '--prefix',
  '--dir',
  '--timeout',
  '--seed',
  '--rerun-each',
  '--reporter',
  '--concurrency',
  '--max-workers',
]);

const REDIRECT = /^\d*(?:[<>]{1,2}|&>{1,2})&?(\S*)$/;

function removeRedirects(words: string[]) {
  const kept: string[] = [];
  for (let index = 0; index < words.length; index += 1) {
    const redirect = REDIRECT.exec(words[index] ?? '');
    if (!redirect) kept.push(words[index] ?? '');
    else if (!redirect[1]) index += 1;
  }
  return kept;
}

function removeWrappers(words: string[]) {
  let start = 0;
  while (start < words.length) {
    const word = words[start] ?? '';
    const options = WRAPPERS.get(word.slice(word.lastIndexOf('/') + 1));
    if (/^\w+=/.test(word)) start += 1;
    else if (options) {
      start += 1;
      while (start < words.length - 1 && options.test(words[start] ?? '')) start += 1;
    } else break;
  }
  return words.slice(start);
}

function removeOptions(words: string[]) {
  const kept: string[] = [];
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index] ?? '';
    if (VALUED_OPTIONS.has(word)) index += 1;
    else if (!word.startsWith('-')) kept.push(word);
  }
  return kept;
}

function resolveSuiteCore(segment: string) {
  const words = segment
    .replace(/\$\(|["'`(){}]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  return removeOptions(removeWrappers(removeRedirects(words))).join(' ');
}

export function isWholeSuiteCommand(command: string) {
  return command
    .split(SEGMENT_SEPARATOR)
    .map(resolveSuiteCore)
    .some((core) => WHOLE_SUITES.some((pattern) => pattern.test(core)));
}

export function describeWholeSuiteRefusal(path: string, command: string) {
  return `${path} \`${command}\` runs the whole suite. Scope it to what the change touches: the test files or folder, one package’s type check (\`bun run --cwd apps/web check-types\`), the linter on the changed paths. CI runs the whole suite on the pull request.`;
}

export function listRepoChecks(repo: Pick<Repo, 'checkCommands'> | null): TaskCheck[] {
  return (repo?.checkCommands ?? []).map((command, index) => ({
    id: `r${index + 1}`,
    label: command,
    command,
    phases: [],
    source: 'repo',
  }));
}

export function listTaskChecks(task: Pick<Task, 'checks'>, repo: Pick<Repo, 'checkCommands'> | null) {
  return [...(task.checks ?? []), ...listRepoChecks(repo)];
}

export function listPhaseChecks(task: Pick<Task, 'checks'>, phase: number) {
  return (task.checks ?? []).filter((check) => check.phases.includes(phase));
}

export function listTouchedPhaseChecks(
  task: Pick<Task, 'checks' | 'phaseReports'>,
  files: readonly string[]
) {
  const changed = new Set(files);
  const phases = new Set(
    task.phaseReports
      .filter((report) => (report.files ?? []).some((file) => changed.has(file)))
      .map((report) => report.index + 1)
  );
  return (task.checks ?? []).filter((check) => check.phases.some((phase) => phases.has(phase)));
}

export function resolveNextCheckId(task: Pick<Task, 'checks'>) {
  const numbers = (task.checks ?? []).map((check) => Number(check.id.slice(1)) || 0);
  return `c${Math.max(0, ...numbers) + 1}`;
}

export function isBlockingCheck(check: ReportCheck) {
  return check.outcome === 'fail' && check.note !== 'fails_on_base';
}

export function listBlockingChecks(task: Pick<Task, 'checkResults'>) {
  return (task.checkResults ?? []).filter(isBlockingCheck);
}
