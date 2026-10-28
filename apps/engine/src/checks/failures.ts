import { isAbsolute, relative } from 'node:path';
import { describeCount } from '@shinsa/core';
import { listFailedTestCases } from './reruns.ts';

type FailureKind = 'test' | 'type' | 'lint' | 'error';

export interface CheckFailure {
  kind: FailureKind;
  file: string;
  key: string;
  label: string;
}

export interface FailureDiff {
  added: CheckFailure[];
  known: CheckFailure[];
}

interface Diagnostic {
  kind: FailureKind;
  file: string;
  code: string;
  message: string;
}

interface ParseState {
  diagnostics: Diagnostic[];
  biome: Diagnostic | null;
  eslintFile: string | null;
}

const LISTED_FAILURES = 10;

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');

const TSC = /(?:^|\s)(\S+?)(?:\(\d+,\d+\):|:\d+:\d+ -) error (TS\d+): (.+)$/;

const BIOME_HEADER =
  /(?:^|\s)(\S+?)(?::\d+:\d+)?\s+((?:lint|format|assist|parse|syntax|suppressions|plugin)\b[\w/-]*).*━{3}/;

const BIOME_MESSAGE = /^\s*[✖×!ℹi] (.+)$/;

const ESLINT_FILE = /^(\/\S+|[\w@.~-][\w@./~-]*\.\w+)\s*$/;

const ESLINT_ENTRY = /^\s+\d+:\d+\s+(?:error|warning)\s+(.+?)(?:\s{2,}([@\w./-]+))?\s*$/;

const PRETTIER = /^\[warn\] (\S+\.\w+)$/;

const LOCATED = /^(?:\.\/)?([\w@/~-][\w@./~-]*\.\w+):\d+(?::\d+)?:?\s+(.+)$/;

const POSITION_WORDS = /\b(line|column|col)\s+\d+/gi;

const NOUNS: Record<FailureKind, string> = {
  test: 'failing test',
  type: 'type error',
  lint: 'lint error',
  error: 'error',
};

function normaliseFile(file: string, root: string) {
  const path = file.replace(/\\/g, '/').replace(/^\.\//, '');
  if (!isAbsolute(path)) return path;
  const inside = relative(root, path);
  return inside.startsWith('..') ? path : inside;
}

function normaliseMessage(message: string) {
  return message.replace(POSITION_WORDS, '$1 #').replace(/\s+/g, ' ').trim();
}

function flushBiome(state: ParseState) {
  if (state.biome) state.diagnostics.push(state.biome);
  state.biome = null;
}

function parseLine(line: string, state: ParseState) {
  const tsc = TSC.exec(line);
  if (tsc) {
    state.diagnostics.push({ kind: 'type', file: tsc[1] ?? '', code: tsc[2] ?? '', message: tsc[3] ?? '' });
    return;
  }
  const header = BIOME_HEADER.exec(line);
  if (header) {
    flushBiome(state);
    state.biome = { kind: 'lint', file: header[1] ?? '', code: header[2] ?? '', message: '' };
    return;
  }
  const biomeMessage = state.biome ? BIOME_MESSAGE.exec(line) : null;
  if (state.biome && biomeMessage) {
    state.biome.message = biomeMessage[1] ?? '';
    flushBiome(state);
    return;
  }
  if (line.trim() === '') {
    state.eslintFile = null;
    return;
  }
  const entry = state.eslintFile ? ESLINT_ENTRY.exec(line) : null;
  if (state.eslintFile && entry) {
    const [, message = '', code = ''] = entry;
    state.diagnostics.push({ kind: 'lint', file: state.eslintFile, code, message });
    return;
  }
  const file = ESLINT_FILE.exec(line);
  if (file) {
    state.eslintFile = file[1] ?? null;
    return;
  }
  const unformatted = PRETTIER.exec(line);
  if (unformatted) {
    state.diagnostics.push({ kind: 'lint', file: unformatted[1] ?? '', code: 'prettier', message: '' });
    return;
  }
  const located = LOCATED.exec(line);
  if (located)
    state.diagnostics.push({ kind: 'error', file: located[1] ?? '', code: '', message: located[2] ?? '' });
}

function listDiagnostics(output: string, root: string): CheckFailure[] {
  const state: ParseState = { diagnostics: [], biome: null, eslintFile: null };
  for (const line of output.replace(ANSI, '').split(/\r?\n/)) parseLine(line, state);
  flushBiome(state);
  return state.diagnostics.map(({ kind, file, code, message }) => {
    const path = normaliseFile(file, root);
    const text = normaliseMessage(message);
    const label = [code, text].filter((part) => part.length > 0).join(' ');
    return { kind, file: path, key: `${path}\n${code}\n${text}`, label: `${path}: ${label}` };
  });
}

export function listCheckFailures(output: string, root: string): CheckFailure[] | null {
  const cases = listFailedTestCases(output, root);
  if (cases) {
    return cases.map(({ file, test }) => ({
      kind: 'test',
      file,
      key: `${file}\n${test}`,
      label: test ? `${file} › ${test}` : file,
    }));
  }
  const diagnostics = listDiagnostics(output, root);
  return diagnostics.length > 0 ? diagnostics : null;
}

export function resolveFailureDiff(failures: readonly CheckFailure[], onBase: readonly CheckFailure[]) {
  const counts = new Map<string, number>();
  for (const failure of onBase) counts.set(failure.key, (counts.get(failure.key) ?? 0) + 1);
  const diff: FailureDiff = { added: [], known: [] };
  for (const failure of failures) {
    const left = counts.get(failure.key) ?? 0;
    if (left === 0) {
      diff.added.push(failure);
      continue;
    }
    counts.set(failure.key, left - 1);
    diff.known.push(failure);
  }
  return diff;
}

function resolveNoun(failures: readonly CheckFailure[]) {
  const [kind, ...others] = new Set(failures.map((failure) => failure.kind));
  return kind && others.length === 0 ? NOUNS[kind] : NOUNS.error;
}

export function describeFailureDiff({ added, known }: FailureDiff) {
  const noun = resolveNoun([...added, ...known]);
  if (added.length === 0) return `${describeCount(known.length, noun)}, all already on the base branch.`;
  const onBase =
    known.length === 0 ? 'none on the base branch' : `${known.length} already on the base branch`;
  const listed = added.slice(0, LISTED_FAILURES).map((failure) => `- ${failure.label}`);
  const more = added.length - listed.length;
  const lines = [
    `${describeCount(added.length, `new ${noun}`)}, ${onBase}:`,
    ...listed,
    ...(more > 0 ? [`- and ${more} more`] : []),
  ];
  return lines.join('\n');
}
