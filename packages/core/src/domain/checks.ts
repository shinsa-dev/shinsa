import type { ReportCheck, TaskCheck } from '../report/types.ts';
import type { Repo, Task } from './types.ts';

const WHOLE_SUITES = [
  /^(?:bun|npm|pnpm|yarn)(?: run)? test$/,
  /^(?:bunx |npx |pnpm exec |yarn )?(?:vitest(?: run)?|jest)$/,
  /^(?:python3? -m )?pytest$/,
  /^(?:uv run |poetry run )pytest$/,
  /^go test \.\/\.\.\.$/,
  /^cargo test$/,
  /^make (?:test|check)$/,
  /^(?:bun|npm|pnpm|yarn)(?: run)? (?:check|ci|verify|test:all)$/,
];

export function isWholeSuiteCommand(command: string) {
  const normalised = command.trim().replace(/\s+/g, ' ');
  return WHOLE_SUITES.some((pattern) => pattern.test(normalised));
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
