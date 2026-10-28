import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';

export type TestRunner = 'bun' | 'vitest' | 'jest';

export interface FailedTestGroup {
  runner: TestRunner;
  packageDir: string;
  files: string[];
}

export type FailedTests =
  | { kind: 'none' }
  | { kind: 'clean' }
  | { kind: 'unknown' }
  | { kind: 'files'; groups: FailedTestGroup[] };

export interface FailedTestCase {
  file: string;
  test: string;
}

interface FailedFile {
  runner: TestRunner | null;
  prefix: string;
  path: string;
  test: string;
}

interface ResolvedFile {
  runner: TestRunner;
  packageDir: string;
  file: string;
  test: string;
}

type ResolvedFailures = Exclude<FailedTests, { kind: 'files' }> | { kind: 'files'; files: ResolvedFile[] };

interface ParsedOutput {
  files: FailedFile[];
  attributed: boolean;
  bun: boolean;
  bunFails: number;
}

const TEST_PATH = String.raw`([^\s:|]+[._](?:test|spec)\.[cm]?[jt]sx?)`;

const BUN_HEADER = new RegExp(String.raw`^(|.*\s)${TEST_PATH}:\s*$`);

const BUN_FAIL = /^(|.*?\s)\(fail\) /;

const BUN_DURATION = /\s*\[[\d.]+m?s\]\s*$/;

const JEST_CASE = /^(|.*?\s)● (.+)$/;

const BUN_FAIL_COUNT = /(?:^|\s)(\d+) fail\s*$/;

const BUN_RECAP = /(?:^|\s)\d+ tests? failed:\s*$/;

const BUN_MARK = /(?:^|\s)bun test v\d|(?:^|\s)\((?:pass|fail)\) /;

const RUNNER_FAIL = new RegExp(String.raw`^(|.*?\s)FAIL\s+(?:\|[^|]*\|\s+)?${TEST_PATH}(?:\s|$)`);

const BUN_ERROR = /Unhandled error|errors? between tests/i;

const GROUP_MARKER = /::group::/;

const UNATTRIBUTED =
  /Unhandled (?:errors?|rejection)|errors? between tests|coverage threshold|does not meet (?:the )?(?:global )?threshold/i;

const COVERAGE_TOTAL = /All files\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)/;

function readJson(path: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(readFileSync(path, 'utf8'));
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function listPatterns(root: string) {
  const workspaces = readJson(join(root, 'package.json'))?.workspaces;
  const listed = Array.isArray(workspaces)
    ? workspaces
    : ((workspaces as { packages?: unknown } | undefined)?.packages ?? []);
  const patterns = Array.isArray(listed) ? listed.filter((item) => typeof item === 'string') : [];
  const pnpm = join(root, 'pnpm-workspace.yaml');
  if (!existsSync(pnpm)) return patterns;
  const lines = readFileSync(pnpm, 'utf8').split('\n');
  return [...patterns, ...lines.flatMap((line) => /^\s*-\s*['"]?([^'"#\s]+)['"]?/.exec(line)?.[1] ?? [])];
}

function isFolder(path: string) {
  return existsSync(path) && statSync(path).isDirectory();
}

function listWorkspaceDirs(root: string) {
  return listPatterns(root).flatMap((pattern) => {
    if (!pattern.includes('*')) return [join(root, pattern)];
    if (!pattern.endsWith('/*') || pattern.slice(0, -2).includes('*')) return [];
    const parent = join(root, pattern.slice(0, -2));
    if (!isFolder(parent)) return [];
    return readdirSync(parent)
      .map((name) => join(parent, name))
      .filter(isFolder);
  });
}

function isInside(path: string, root: string) {
  return path === root || path.startsWith(`${root}${sep}`);
}

function resolvePackageDir(file: string, root: string) {
  for (let dir = dirname(file); isInside(dir, root); dir = dirname(dir)) {
    if (existsSync(join(dir, 'package.json'))) return dir;
    if (dir === root) break;
  }
  return null;
}

function readPackageName(dir: string) {
  const name = readJson(join(dir, 'package.json'))?.name;
  return typeof name === 'string' ? name : null;
}

function resolveTestFile(root: string, dirs: readonly string[], failed: FailedFile) {
  if (isAbsolute(failed.path))
    return isInside(failed.path, root) && existsSync(failed.path) ? failed.path : null;
  const found = [...new Set([root, ...dirs].map((dir) => join(dir, failed.path)))].filter(existsSync);
  if (found.length <= 1) return found[0] ?? null;
  const named = found.filter((file) => {
    const dir = resolvePackageDir(file, root);
    const name = dir ? readPackageName(dir) : null;
    return name !== null && failed.prefix.includes(name);
  });
  return named.length === 1 ? (named[0] ?? null) : null;
}

function resolveRunner(packageDir: string): TestRunner | null {
  const manifest = readJson(join(packageDir, 'package.json')) ?? {};
  const fields = ['dependencies', 'devDependencies'].map((key) => manifest[key] ?? {});
  const names = fields.flatMap((field) => Object.keys(field as Record<string, unknown>));
  const scripts = (manifest.scripts ?? {}) as Record<string, unknown>;
  const words = [...names, String(scripts.test ?? '')].join(' ');
  if (/\bvitest\b/.test(words)) return 'vitest';
  if (/\bjest\b/.test(words)) return 'jest';
  return null;
}

function parseBunLine(line: string, current: Map<string, string | null>, parsed: ParsedOutput) {
  const header = BUN_HEADER.exec(line);
  if (header) {
    current.set(header[1] ?? '', header[2] ?? '');
    return 0;
  }
  const recap = BUN_RECAP.exec(line);
  if (recap) {
    current.set(line.slice(0, recap.index), null);
    return 0;
  }
  const fail = BUN_FAIL.exec(line);
  if (!fail) return 0;
  const prefix = fail[1] ?? '';
  if (!current.has(prefix)) {
    parsed.attributed = false;
    return 0;
  }
  const path = current.get(prefix);
  if (!path) return 0;
  const test = line.slice(fail[0].length).replace(BUN_DURATION, '').trim();
  parsed.files.push({ runner: 'bun', prefix, path, test });
  return 1;
}

function readRunnerTest(rest: string) {
  return rest
    .replace(/^\s*>\s*/, '')
    .replace(/\s*(?:\[[^\]]*\]|\([\d.]+\s*m?s\))\s*$/, '')
    .trim();
}

function parseRunnerLine(line: string, parsed: ParsedOutput) {
  const failed = RUNNER_FAIL.exec(line);
  if (failed) {
    const prefix = failed[1] ?? '';
    const path = failed[2] ?? '';
    const test = readRunnerTest(line.slice(failed[0].length));
    parsed.files.push({ runner: null, prefix, path, test });
    return;
  }
  const named = JEST_CASE.exec(line);
  const last = parsed.files.at(-1);
  const test = (named?.[2] ?? '').trim();
  if (!last || last.runner !== null || test === '' || test === 'Console') return;
  parsed.files.push({ ...last, test });
}

function parseOutput(output: string): ParsedOutput {
  const parsed: ParsedOutput = { files: [], attributed: true, bun: false, bunFails: 0 };
  const current = new Map<string, string | null>();
  let attributedFails = 0;
  for (const line of output.split(/\r?\n/).map((text) => text.replace(GROUP_MARKER, ''))) {
    if (BUN_MARK.test(line)) parsed.bun = true;
    if (UNATTRIBUTED.test(line)) parsed.attributed = false;
    attributedFails += parseBunLine(line, current, parsed);
    parsed.bunFails += Number(BUN_FAIL_COUNT.exec(line)?.[1] ?? 0);
    parseRunnerLine(line, parsed);
  }
  if (parsed.bun && attributedFails !== parsed.bunFails) parsed.attributed = false;
  return parsed;
}

function hasBunCoverageMiss(output: string) {
  return output.split(/\r?\n/).some((line) => {
    const total = COVERAGE_TOTAL.exec(line);
    return total !== null && (Number(total[1]) < 100 || Number(total[2]) < 100);
  });
}

function groupFiles(files: readonly ResolvedFile[]) {
  const groups = new Map<string, FailedTestGroup>();
  for (const { runner, packageDir, file } of files) {
    const key = `${runner}\n${packageDir}`;
    const group = groups.get(key) ?? { runner, packageDir, files: [] };
    const path = relative(packageDir, file);
    if (!group.files.includes(path)) group.files.push(path);
    groups.set(key, group);
  }
  return [...groups.values()];
}

function resolveFailures(output: string, root: string): ResolvedFailures {
  const parsed = parseOutput(output);
  if (!parsed.attributed) return { kind: 'unknown' };
  if (parsed.files.length === 0) return parsed.bun ? { kind: 'clean' } : { kind: 'none' };
  const dirs = listWorkspaceDirs(root);
  const resolved: ResolvedFile[] = [];
  for (const failed of parsed.files) {
    const file = resolveTestFile(root, dirs, failed);
    const packageDir = file ? resolvePackageDir(file, root) : null;
    const runner = packageDir ? (failed.runner ?? resolveRunner(packageDir)) : null;
    if (!file || !packageDir || !runner) return { kind: 'unknown' };
    resolved.push({ runner, packageDir, file, test: failed.test });
  }
  return { kind: 'files', files: resolved };
}

export function listFailedTests(output: string, root: string): FailedTests {
  const failures = resolveFailures(output, root);
  if (failures.kind !== 'files') return failures;
  return { kind: 'files', groups: groupFiles(failures.files) };
}

export function listFailedTestCases(output: string, root: string): FailedTestCase[] | null {
  const failures = resolveFailures(output, root);
  if (failures.kind !== 'files') return null;
  const cases = new Map<string, FailedTestCase>();
  for (const { file, test } of failures.files) {
    const path = relative(root, file);
    cases.set(`${path}\n${test}`, { file: path, test });
  }
  return [...cases.values()];
}

export function isCoverageFloorOnly(output: string) {
  const parsed = parseOutput(output);
  if (!parsed.bun || !parsed.attributed || parsed.files.length > 0 || parsed.bunFails > 0) return false;
  const lines = output.split(/\r?\n/);
  return hasBunCoverageMiss(output) && lines.some((line) => BUN_FAIL_COUNT.exec(line)?.[1] === '0');
}

function selectBin(packageDir: string, root: string, name: string) {
  for (let dir = packageDir; isInside(dir, root); dir = dirname(dir)) {
    const bin = join(dir, 'node_modules', '.bin', name);
    if (existsSync(bin)) return bin;
    if (dir === root) break;
  }
  return null;
}

export function resolveRerunCommand(group: FailedTestGroup, root: string): string[] | null {
  if (group.runner === 'bun') return ['bun', 'test', ...group.files.map((file) => `./${file}`)];
  const bin = selectBin(group.packageDir, root, group.runner);
  if (!bin) return null;
  if (group.runner === 'vitest') return [bin, 'run', '--coverage.enabled=false', ...group.files];
  return [bin, '--coverage=false', '--runTestsByPath', ...group.files];
}

export function isRerunPassed(runner: TestRunner, output: string, ok: boolean) {
  if (runner !== 'bun') return ok;
  const lines = output.split(/\r?\n/);
  if (lines.some((line) => BUN_FAIL.test(line) || BUN_ERROR.test(line))) return false;
  return lines.some((line) => BUN_FAIL_COUNT.exec(line)?.[1] === '0');
}
