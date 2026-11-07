import { dirname, isAbsolute, join, relative } from 'node:path';
import { Effect, Option } from 'effect';
import { listDependencyNames, listWorkspacePatterns, selectPackageManifest } from '../files/manifest.ts';
import { isInside } from '../files/paths.ts';
import { isFolder, isPresent, listEntries, selectText } from '../files/probe.ts';
import { PACKAGE_MANIFEST } from '../files/schema.ts';
import type { FailedTestCase, FailedTestGroup, FailedTests, TestRunner } from './schema.ts';

export type { FailedTestCase, FailedTestGroup, TestRunner } from './schema.ts';

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

const PNPM_ITEM = /^\s*-\s*['"]?([^'"#\s]+)['"]?/;

const listPatterns = Effect.fn('Reruns.listPatterns')(function* (root: string) {
  const manifest = yield* selectPackageManifest(root);
  const patterns = Option.match(manifest, { onNone: () => [], onSome: listWorkspacePatterns });
  const pnpm = yield* selectText(join(root, 'pnpm-workspace.yaml'));
  if (Option.isNone(pnpm)) return patterns;
  return [...patterns, ...pnpm.value.split('\n').flatMap((line) => PNPM_ITEM.exec(line)?.[1] ?? [])];
});

const listWorkspaceDirs = Effect.fn('Reruns.listWorkspaceDirs')(function* (root: string) {
  const dirs: string[] = [];
  for (const pattern of yield* listPatterns(root)) {
    if (!pattern.includes('*')) {
      dirs.push(join(root, pattern));
      continue;
    }
    if (!pattern.endsWith('/*') || pattern.slice(0, -2).includes('*')) continue;
    const parent = join(root, pattern.slice(0, -2));
    if (!(yield* isFolder(parent))) continue;
    for (const name of yield* listEntries(parent))
      if (yield* isFolder(join(parent, name))) dirs.push(join(parent, name));
  }
  return dirs;
});

const selectPackageDir = Effect.fn('Reruns.selectPackageDir')(function* (file: string, root: string) {
  for (let dir = dirname(file); isInside(root, dir); dir = dirname(dir)) {
    if (yield* isPresent(join(dir, PACKAGE_MANIFEST))) return Option.some(dir);
    if (dir === root) break;
  }
  return Option.none<string>();
});

const isNamedFor = Effect.fn('Reruns.isNamedFor')(function* (file: string, root: string, prefix: string) {
  const dir = yield* selectPackageDir(file, root);
  if (Option.isNone(dir)) return false;
  const manifest = yield* selectPackageManifest(dir.value);
  const name = Option.flatMap(manifest, (each) => Option.fromNullishOr(each.name));
  return Option.isSome(name) && prefix.includes(name.value);
});

const selectTestFile = Effect.fn('Reruns.selectTestFile')(function* (
  root: string,
  dirs: readonly string[],
  failed: FailedFile
) {
  if (isAbsolute(failed.path)) {
    const found = isInside(root, failed.path) && (yield* isPresent(failed.path));
    return found ? Option.some(failed.path) : Option.none<string>();
  }
  const candidates = [...new Set([root, ...dirs].map((dir) => join(dir, failed.path)))];
  const found = yield* Effect.filter(candidates, isPresent);
  if (found.length <= 1) return Option.fromNullishOr(found[0]);
  const named = yield* Effect.filter(found, (file) => isNamedFor(file, root, failed.prefix));
  return named.length === 1 ? Option.fromNullishOr(named[0]) : Option.none<string>();
});

const selectRunner = Effect.fn('Reruns.selectRunner')(function* (packageDir: string) {
  const manifest = Option.getOrNull(yield* selectPackageManifest(packageDir));
  const names = manifest ? listDependencyNames(manifest) : [];
  const words = [...names, manifest?.scripts?.test ?? ''].join(' ');
  if (/\bvitest\b/.test(words)) return Option.some<TestRunner>('vitest');
  if (/\bjest\b/.test(words)) return Option.some<TestRunner>('jest');
  return Option.none<TestRunner>();
});

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

const resolveFailures = Effect.fn('Reruns.resolveFailures')(function* (output: string, root: string) {
  const parsed = parseOutput(output);
  if (!parsed.attributed) return { kind: 'unknown' } satisfies ResolvedFailures;
  if (parsed.files.length === 0)
    return (parsed.bun ? { kind: 'clean' } : { kind: 'none' }) satisfies ResolvedFailures;
  const dirs = yield* listWorkspaceDirs(root);
  const files: ResolvedFile[] = [];
  for (const failed of parsed.files) {
    const file = yield* selectTestFile(root, dirs, failed);
    if (Option.isNone(file)) return { kind: 'unknown' } satisfies ResolvedFailures;
    const packageDir = yield* selectPackageDir(file.value, root);
    if (Option.isNone(packageDir)) return { kind: 'unknown' } satisfies ResolvedFailures;
    const runner = failed.runner ? Option.some(failed.runner) : yield* selectRunner(packageDir.value);
    if (Option.isNone(runner)) return { kind: 'unknown' } satisfies ResolvedFailures;
    files.push({ runner: runner.value, packageDir: packageDir.value, file: file.value, test: failed.test });
  }
  return { kind: 'files', files } satisfies ResolvedFailures;
});

export const listFailedTests = Effect.fn('Reruns.listFailedTests')(function* (output: string, root: string) {
  const failures: ResolvedFailures = yield* resolveFailures(output, root);
  if (failures.kind !== 'files') return failures satisfies FailedTests;
  return { kind: 'files', groups: groupFiles(failures.files) } satisfies FailedTests;
});

export const selectFailedTestCases = Effect.fn('Reruns.selectFailedTestCases')(function* (
  output: string,
  root: string
) {
  const failures: ResolvedFailures = yield* resolveFailures(output, root);
  if (failures.kind !== 'files') return Option.none<FailedTestCase[]>();
  const cases = new Map<string, FailedTestCase>();
  for (const { file, test } of failures.files) {
    const path = relative(root, file);
    cases.set(`${path}\n${test}`, { file: path, test });
  }
  return Option.some([...cases.values()]);
});

export function isCoverageFloorOnly(output: string) {
  const parsed = parseOutput(output);
  if (!parsed.bun || !parsed.attributed || parsed.files.length > 0 || parsed.bunFails > 0) return false;
  const lines = output.split(/\r?\n/);
  return hasBunCoverageMiss(output) && lines.some((line) => BUN_FAIL_COUNT.exec(line)?.[1] === '0');
}

const selectBin = Effect.fn('Reruns.selectBin')(function* (packageDir: string, root: string, name: string) {
  for (let dir = packageDir; isInside(root, dir); dir = dirname(dir)) {
    const bin = join(dir, 'node_modules', '.bin', name);
    if (yield* isPresent(bin)) return Option.some(bin);
    if (dir === root) break;
  }
  return Option.none<string>();
});

export const selectRerunCommand = Effect.fn('Reruns.selectRerunCommand')(function* (
  group: FailedTestGroup,
  root: string
) {
  if (group.runner === 'bun') return Option.some(['bun', 'test', ...group.files.map((file) => `./${file}`)]);
  const bin = yield* selectBin(group.packageDir, root, group.runner);
  if (Option.isNone(bin)) return Option.none<string[]>();
  if (group.runner === 'vitest')
    return Option.some([bin.value, 'run', '--coverage.enabled=false', ...group.files]);
  return Option.some([bin.value, '--coverage=false', '--runTestsByPath', ...group.files]);
});

export function isRerunPassed(runner: TestRunner, output: string, ok: boolean) {
  if (runner !== 'bun') return ok;
  const lines = output.split(/\r?\n/);
  if (lines.some((line) => BUN_FAIL.test(line) || BUN_ERROR.test(line))) return false;
  return lines.some((line) => BUN_FAIL_COUNT.exec(line)?.[1] === '0');
}
