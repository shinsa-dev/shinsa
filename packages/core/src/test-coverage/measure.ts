import {
  type ChangedLines,
  COVERAGE_LIMITS,
  type CoverageFile,
  type CoverageHits,
  type CoverageRange,
  type MeasuredCoverage,
} from './types.ts';

export interface CoverageInput {
  command: string;
  changed: ChangedLines;
  hits: CoverageHits;
  roots: readonly string[];
  modulePath: string | null;
}

function normalizeSegments(path: string) {
  const absolute = path.startsWith('/');
  const segments: string[] = [];
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..' && segments.length > 0 && segments.at(-1) !== '..') segments.pop();
    else segments.push(segment);
  }
  return `${absolute ? '/' : ''}${segments.join('/')}`;
}

function stripPrefix(path: string, prefix: string) {
  const root = normalizeSegments(prefix.replace(/\\/g, '/'));
  if (!root || root === '/') return null;
  return path.startsWith(`${root}/`) ? path.slice(root.length + 1) : null;
}

export function resolveReportPath(path: string, roots: readonly string[], modulePath: string | null) {
  const normalized = normalizeSegments(path.replace(/\\/g, '/'));
  for (const root of roots) {
    const relative = stripPrefix(normalized, root);
    if (relative) return relative;
  }
  if (modulePath) return stripPrefix(normalized, modulePath) ?? normalized;
  return normalized;
}

function indexReport(input: CoverageInput) {
  const index = new Map<string, Map<number, number>>();
  for (const [path, lines] of input.hits) {
    const key = resolveReportPath(path, input.roots, input.modulePath);
    const known = index.get(key);
    if (!known) {
      index.set(key, new Map(lines));
      continue;
    }
    for (const [line, count] of lines) known.set(line, (known.get(line) ?? 0) + count);
  }
  return index;
}

function selectReportLines(index: Map<string, Map<number, number>>, path: string) {
  const exact = index.get(path);
  if (exact) return exact;
  const matches = [...index.keys()]
    .filter((key) => key.endsWith(`/${path}`))
    .sort((a, b) => a.length - b.length || a.localeCompare(b));
  const first = matches[0];
  return first === undefined ? null : (index.get(first) ?? null);
}

export function resolveCoverageRanges(lines: readonly number[]): CoverageRange[] {
  const sorted = [...new Set(lines)].sort((a, b) => a - b);
  const ranges: CoverageRange[] = [];
  for (const line of sorted) {
    const last = ranges.at(-1);
    if (last && last[1] === line - 1) last[1] = line;
    else ranges.push([line, line]);
  }
  return ranges;
}

function measureFile(path: string, changed: readonly number[], lines: Map<number, number>): CoverageFile {
  const executable = [...new Set(changed)].filter((line) => lines.has(line));
  const uncovered = executable.filter((line) => (lines.get(line) ?? 0) === 0);
  return {
    path,
    covered: executable.length - uncovered.length,
    executable: executable.length,
    uncovered: resolveCoverageRanges(uncovered).slice(0, COVERAGE_LIMITS.ranges),
  };
}

function compareFiles(a: CoverageFile, b: CoverageFile) {
  const missed = b.executable - b.covered - (a.executable - a.covered);
  return missed || a.path.localeCompare(b.path);
}

export function measureCoverage(input: CoverageInput): MeasuredCoverage {
  const index = indexReport(input);
  const files: CoverageFile[] = [];
  for (const [path, changed] of input.changed) {
    const lines = selectReportLines(index, path);
    if (!lines) continue;
    const file = measureFile(path, changed, lines);
    if (file.executable > 0) files.push(file);
  }
  files.sort(compareFiles);
  return {
    status: 'measured',
    command: input.command,
    covered: files.reduce((sum, file) => sum + file.covered, 0),
    executable: files.reduce((sum, file) => sum + file.executable, 0),
    files: files.slice(0, COVERAGE_LIMITS.files),
  };
}
