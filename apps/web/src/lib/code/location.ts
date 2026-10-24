import type { ReviewOrder } from '@/lib/review/targets.ts';

export type CodeMode = 'review' | 'changes' | 'files' | 'search';

type CodeTabKind = 'diff' | 'file';

export interface CodeTabRef {
  kind: CodeTabKind;
  path: string;
}

export interface CodeLocation {
  mode: CodeMode;
  tabs: CodeTabRef[];
  active: CodeTabRef | null;
  preview: string | null;
  line: number | null;
  end: number | null;
  ref: string | null;
  spot: string | null;
  order: ReviewOrder;
  query: string;
  regex: boolean;
  caseSensitive: boolean;
  glob: string;
}

export type CodePatch = Record<string, string | null>;

const CODE_PARAMS = [
  'mode',
  'open',
  'file',
  'diff',
  'preview',
  'line',
  'end',
  'ref',
  'spot',
  'order',
  'q',
  'regex',
  'case',
  'glob',
] as const;

export const MAX_TABS = 8;

const TAB_PREFIX: Record<CodeTabKind, string> = { diff: 'd', file: 'f' };

const CODE_MODES: CodeMode[] = ['review', 'changes', 'files', 'search'];

export function resolveTabKey(tab: CodeTabRef) {
  return `${TAB_PREFIX[tab.kind]}:${tab.path}`;
}

function parseTab(key: string): CodeTabRef | null {
  const kind = key.startsWith('d:') ? 'diff' : key.startsWith('f:') ? 'file' : null;
  const path = key.slice(2);
  return kind && path ? { kind, path } : null;
}

function decodeEntry(entry: string) {
  try {
    return decodeURIComponent(entry);
  } catch {
    return null;
  }
}

export function parseTabs(value: string | null): CodeTabRef[] {
  const tabs: CodeTabRef[] = [];
  for (const entry of (value ?? '').split(',')) {
    const decoded = decodeEntry(entry);
    const tab = decoded ? parseTab(decoded) : null;
    if (tab && !tabs.some((known) => resolveTabKey(known) === resolveTabKey(tab))) tabs.push(tab);
  }
  return tabs;
}

function encodeEntry(entry: string) {
  return entry.replaceAll('%', '%25').replaceAll(',', '%2C');
}

export function serializeTabs(tabs: CodeTabRef[]) {
  if (tabs.length === 0) return null;
  return tabs.map((tab) => encodeEntry(resolveTabKey(tab))).join(',');
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
  const tabs = parseTabs(read('open'));
  const file = read('file');
  const active = file
    ? { kind: read('diff') === '1' ? ('diff' as const) : ('file' as const), path: file }
    : null;
  const listed = active && !tabs.some((tab) => resolveTabKey(tab) === resolveTabKey(active));
  const line = readLine(read('line'));
  const end = readLine(read('end'));
  return {
    mode: mode ?? resolveDefaultMode(modes),
    tabs: listed && active ? [...tabs, active] : tabs,
    active,
    preview: read('preview'),
    line,
    end: line !== null && end !== null && end >= line ? end : null,
    ref: read('ref'),
    spot: read('spot'),
    order: read('order') === 'attention' ? 'attention' : 'walkthrough',
    query: read('q') ?? '',
    regex: read('regex') === '1',
    caseSensitive: read('case') === '1',
    glob: read('glob') ?? '',
  };
}

function isSame(a: CodeTabRef | null, b: CodeTabRef | null) {
  return a !== null && b !== null && resolveTabKey(a) === resolveTabKey(b);
}

function trimTabs(tabs: CodeTabRef[], keep: CodeTabRef) {
  const trimmed = [...tabs];
  while (trimmed.length > MAX_TABS) {
    const index = trimmed.findIndex((tab) => !isSame(tab, keep));
    trimmed.splice(index, 1);
  }
  return trimmed;
}

export interface OpenOptions {
  pin?: boolean;
  line?: number | null;
  end?: number | null;
  spot?: string | null;
}

export function resolveOpenPatch(
  location: CodeLocation,
  tab: CodeTabRef,
  options: OpenOptions = {}
): CodePatch {
  const key = resolveTabKey(tab);
  const known = location.tabs.some((candidate) => resolveTabKey(candidate) === key);
  let tabs = location.tabs;
  let preview = location.preview;
  if (!known) {
    const previewIndex = tabs.findIndex((candidate) => resolveTabKey(candidate) === preview);
    if (previewIndex >= 0) tabs = tabs.map((candidate, index) => (index === previewIndex ? tab : candidate));
    else tabs = [...tabs, tab];
    preview = options.pin ? null : key;
  } else if (options.pin && preview === key) {
    preview = null;
  }
  return {
    open: serializeTabs(trimTabs(tabs, tab)),
    file: tab.path,
    diff: tab.kind === 'diff' ? '1' : null,
    preview,
    line: options.line ? String(options.line) : null,
    end: options.end && options.line && options.end > options.line ? String(options.end) : null,
    spot: options.spot ?? null,
  };
}

export function resolvePinPatch(location: CodeLocation, tab: CodeTabRef): CodePatch {
  return location.preview === resolveTabKey(tab) ? { preview: null } : {};
}

export function resolveClosePatch(location: CodeLocation, tab: CodeTabRef): CodePatch {
  const key = resolveTabKey(tab);
  const index = location.tabs.findIndex((candidate) => resolveTabKey(candidate) === key);
  const tabs = location.tabs.filter((candidate) => resolveTabKey(candidate) !== key);
  const patch: CodePatch = {
    open: serializeTabs(tabs),
    preview: location.preview === key ? null : location.preview,
  };
  if (!isSame(location.active, tab)) return patch;
  const next = tabs[Math.min(Math.max(index, 0), tabs.length - 1)] ?? null;
  return {
    ...patch,
    file: next?.path ?? null,
    diff: next?.kind === 'diff' ? '1' : null,
    line: null,
    end: null,
    spot: null,
  };
}

export function resolveModePatch(mode: CodeMode, modes: CodeMode[]): CodePatch {
  return { mode: mode === resolveDefaultMode(modes) ? null : mode };
}

export function resolveSearchPatch(search: Pick<CodeLocation, 'query' | 'regex' | 'caseSensitive' | 'glob'>) {
  return {
    mode: 'search',
    q: search.query || null,
    regex: search.regex ? '1' : null,
    case: search.caseSensitive ? '1' : null,
    glob: search.glob.trim() || null,
  };
}

export function resolveClearPatch(): CodePatch {
  return Object.fromEntries(CODE_PARAMS.map((name) => [name, null]));
}
