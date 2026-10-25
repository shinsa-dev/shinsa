export type CodeMode = 'changes' | 'files' | 'search';

type CodeFileKind = 'diff' | 'file';

export interface CodeFileRef {
  kind: CodeFileKind;
  path: string;
}

export interface CodeLocation {
  mode: CodeMode;
  active: CodeFileRef | null;
  line: number | null;
  end: number | null;
  ref: string | null;
  spot: string | null;
  query: string;
  regex: boolean;
  caseSensitive: boolean;
  wholeWord: boolean;
  glob: string;
}

export type CodePatch = Record<string, string | null>;

const CODE_PARAMS = [
  'mode',
  'file',
  'diff',
  'line',
  'end',
  'ref',
  'spot',
  'q',
  'regex',
  'case',
  'word',
  'glob',
] as const;

const CODE_MODES: CodeMode[] = ['changes', 'files', 'search'];

export function resolveFileKey(file: CodeFileRef) {
  return `${file.kind === 'diff' ? 'd' : 'f'}:${file.path}`;
}

function readLine(value: string | null) {
  const line = Number(value);
  return Number.isInteger(line) && line > 0 ? line : null;
}

function resolveDefaultMode(modes: CodeMode[]): CodeMode {
  return modes[0] ?? 'files';
}

export function parseCodeLocation(read: (name: string) => string | null, modes: CodeMode[]): CodeLocation {
  const mode = CODE_MODES.find(
    (candidate) => candidate === read('mode') && (candidate === 'search' || modes.includes(candidate))
  );
  const file = read('file');
  const line = readLine(read('line'));
  const end = readLine(read('end'));
  return {
    mode: mode ?? resolveDefaultMode(modes),
    active: file ? { kind: read('diff') === '1' ? 'diff' : 'file', path: file } : null,
    line,
    end: line !== null && end !== null && end >= line ? end : null,
    ref: read('ref'),
    spot: read('spot'),
    query: read('q') ?? '',
    regex: read('regex') === '1',
    caseSensitive: read('case') === '1',
    wholeWord: read('word') === '1',
    glob: read('glob') ?? '',
  };
}

export interface OpenOptions {
  line?: number | null;
  end?: number | null;
  spot?: string | null;
}

export function resolveOpenPatch(file: CodeFileRef, options: OpenOptions = {}): CodePatch {
  return {
    file: file.path,
    diff: file.kind === 'diff' ? '1' : null,
    line: options.line ? String(options.line) : null,
    end: options.end && options.line && options.end > options.line ? String(options.end) : null,
    spot: options.spot ?? null,
  };
}

export function resolveModePatch(mode: CodeMode, modes: CodeMode[]): CodePatch {
  return { mode: mode === resolveDefaultMode(modes) ? null : mode };
}

export function resolveSearchPatch(
  search: Pick<CodeLocation, 'query' | 'regex' | 'caseSensitive' | 'wholeWord' | 'glob'>
) {
  return {
    mode: 'search',
    q: search.query || null,
    regex: search.regex ? '1' : null,
    case: search.caseSensitive ? '1' : null,
    word: search.wholeWord ? '1' : null,
    glob: search.glob.trim() || null,
  };
}

export function resolveClearPatch(): CodePatch {
  return Object.fromEntries(CODE_PARAMS.map((name) => [name, null]));
}
