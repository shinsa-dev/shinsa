import type { Task, TaskStage } from '../domain/index.ts';
import type { ShinsaState } from '../state/project.ts';

export type Reference =
  | { kind: 'task'; id: string }
  | { kind: 'pr'; repo: string | null; number: number }
  | { kind: 'repo'; name: string }
  | { kind: 'branch'; name: string }
  | { kind: 'file'; path: string; line: number | null; end: number | null };

export type ReferenceSource = 'link' | 'url' | 'quoted' | 'title' | 'number';

export interface ReferenceSpan {
  start: number;
  end: number;
  label: string;
  reference: Reference;
  source: ReferenceSource;
}

export interface ReferenceCatalog {
  tasks: { id: string; title: string }[];
  pullRequests: { number: number; repo: string | null; taskId: string }[];
}

export interface ReferenceOptions {
  titles?: boolean;
  numbers?: boolean;
  exclude?: ReadonlySet<string>;
}

export const REFERENCE_SCHEME = 'shinsa://';

const MIN_BARE_TITLE = 12;

const ID = /^[\w.-]+$/;
const NAME = /^[\w.@-]+(?:\/[\w.@-]+)?$/;
const BRANCH = /^[\w.@/+-]+$/;
const FILE_ANCHOR = /^L?(\d+)(?:-L?(\d+))?$/;
const MARKDOWN_LINK = /\[([^\]\n]*)\]\((shinsa:\/\/[^)\s]+)\)/gi;
const BARE_URL = /(?<![([<\w])shinsa:\/\/[^\s)\]>]*[^\s)\]>.,;:!?'"”’]/gi;
const QUOTED = /[“"]([^”"\n]{3,})[”"]/g;
const PULL_NUMBER = /(?<![\w&/#])#(\d{1,6})(?![\w#])/g;
const CODE = /```[\s\S]*?(?:```|$)|`[^`\n]*`/g;
const ANY_LINK = /\[[^\]\n]*\]\([^)\n]*\)|<?https?:\/\/[^\s>]+>?/g;

function decode(part: string) {
  try {
    return decodeURIComponent(part);
  } catch {
    return part;
  }
}

function parseNumber(text: string | undefined) {
  if (!text || !/^\d{1,6}$/.test(text)) return null;
  const value = Number(text);
  return value > 0 ? value : null;
}

function parsePullRequest(rest: string): Reference | null {
  const match = /^(?:(.+?)(?:#|\/))?#?(\d{1,6})$/.exec(rest);
  if (!match) return null;
  const number = parseNumber(match[2]);
  if (number === null) return null;
  const repo = match[1] ? decode(match[1]) : null;
  if (repo !== null && !NAME.test(repo)) return null;
  return { kind: 'pr', repo, number };
}

function parseFile(rest: string): Reference | null {
  const hash = rest.indexOf('#');
  const path = decode(hash < 0 ? rest : rest.slice(0, hash)).replace(/^\/+/, '');
  if (!path || path.split('/').some((segment) => segment === '' || segment === '..')) return null;
  const anchor = hash < 0 ? null : FILE_ANCHOR.exec(rest.slice(hash + 1));
  if (hash >= 0 && !anchor) return null;
  const line = parseNumber(anchor?.[1]);
  const end = parseNumber(anchor?.[2]);
  return { kind: 'file', path, line, end: line !== null && end !== null && end > line ? end : null };
}

export function parseReference(href: string): Reference | null {
  if (href.slice(0, REFERENCE_SCHEME.length).toLowerCase() !== REFERENCE_SCHEME) return null;
  const body = href.slice(REFERENCE_SCHEME.length);
  const slash = body.indexOf('/');
  if (slash <= 0) return null;
  const kind = body.slice(0, slash).toLowerCase();
  const rest = body.slice(slash + 1);
  if (!rest) return null;
  switch (kind) {
    case 'task': {
      const id = decode(rest);
      return ID.test(id) ? { kind: 'task', id } : null;
    }
    case 'pr':
      return parsePullRequest(rest);
    case 'repo': {
      const name = decode(rest);
      return NAME.test(name) ? { kind: 'repo', name } : null;
    }
    case 'branch': {
      const name = decode(rest);
      return BRANCH.test(name) && !name.includes('..') ? { kind: 'branch', name } : null;
    }
    case 'file':
      return parseFile(rest);
    default:
      return null;
  }
}

export function serializeReference(reference: Reference) {
  switch (reference.kind) {
    case 'task':
      return `${REFERENCE_SCHEME}task/${reference.id}`;
    case 'pr':
      return `${REFERENCE_SCHEME}pr/${reference.repo ? `${reference.repo}#` : ''}${reference.number}`;
    case 'repo':
      return `${REFERENCE_SCHEME}repo/${reference.name}`;
    case 'branch':
      return `${REFERENCE_SCHEME}branch/${reference.name}`;
    case 'file': {
      const anchor =
        reference.line === null
          ? ''
          : `#L${reference.line}${reference.end === null ? '' : `-L${reference.end}`}`;
      return `${REFERENCE_SCHEME}file/${reference.path}${anchor}`;
    }
  }
}

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function listRanges(text: string, pattern: RegExp) {
  return [...text.matchAll(pattern)].map((match) => [match.index, match.index + match[0].length] as const);
}

function listExplicitSpans(text: string) {
  const spans: ReferenceSpan[] = [];
  for (const match of text.matchAll(MARKDOWN_LINK)) {
    const reference = parseReference(match[2] ?? '');
    if (!reference) continue;
    spans.push({
      start: match.index,
      end: match.index + match[0].length,
      label: match[1] ?? '',
      reference,
      source: 'link',
    });
  }
  for (const match of text.matchAll(BARE_URL)) {
    const reference = parseReference(match[0]);
    if (!reference) continue;
    spans.push({
      start: match.index,
      end: match.index + match[0].length,
      label: '',
      reference,
      source: 'url',
    });
  }
  return spans;
}

function listTitleSpans(text: string, catalog: ReferenceCatalog, exclude: ReadonlySet<string>) {
  const tasks = catalog.tasks.filter((task) => !exclude.has(task.id));
  const byTitle = new Map(tasks.map((task) => [task.title.trim().toLowerCase(), task]));
  const spans: ReferenceSpan[] = [];
  for (const match of text.matchAll(QUOTED)) {
    const task = byTitle.get((match[1] ?? '').trim().toLowerCase());
    if (!task) continue;
    spans.push({
      start: match.index,
      end: match.index + match[0].length,
      label: task.title,
      reference: { kind: 'task', id: task.id },
      source: 'quoted',
    });
  }
  for (const task of tasks) {
    if (task.title.length < MIN_BARE_TITLE) continue;
    const pattern = new RegExp(`(?<![\\w-])${escapeRegExp(task.title)}(?![\\w-])`, 'g');
    for (const match of text.matchAll(pattern)) {
      spans.push({
        start: match.index,
        end: match.index + match[0].length,
        label: task.title,
        reference: { kind: 'task', id: task.id },
        source: 'title',
      });
    }
  }
  return spans;
}

function listNumberSpans(text: string, catalog: ReferenceCatalog) {
  const spans: ReferenceSpan[] = [];
  for (const match of text.matchAll(PULL_NUMBER)) {
    const number = Number(match[1]);
    const owners = catalog.pullRequests.filter((pullRequest) => pullRequest.number === number);
    const owner = owners[0];
    if (!owner || owners.length > 1) continue;
    spans.push({
      start: match.index,
      end: match.index + match[0].length,
      label: match[0],
      reference: { kind: 'pr', repo: owner.repo, number },
      source: 'number',
    });
  }
  return spans;
}

export function listReferenceSpans(
  text: string,
  catalog: ReferenceCatalog,
  { titles = true, numbers = true, exclude = new Set() }: ReferenceOptions = {}
) {
  const code = listRanges(text, CODE);
  const links = listRanges(text, ANY_LINK);
  const explicit = listExplicitSpans(text);
  const candidates = [
    ...explicit,
    ...(titles ? listTitleSpans(text, catalog, exclude) : []),
    ...(numbers ? listNumberSpans(text, catalog) : []),
  ]
    .filter((span) => !code.some(([start, end]) => span.start < end && span.end > start))
    .filter(
      (span) =>
        span.source === 'link' ||
        span.source === 'url' ||
        !links.some(([start, end]) => span.start < end && span.end > start)
    )
    .sort((a, b) => a.start - b.start || b.end - a.end);
  const spans: ReferenceSpan[] = [];
  let cursor = 0;
  for (const span of candidates) {
    if (span.start < cursor) continue;
    spans.push(span);
    cursor = span.end;
  }
  return spans;
}

function escapeLabel(label: string) {
  return label.replace(/[[\]\\]/g, '\\$&');
}

export function linkReferences(text: string, catalog: ReferenceCatalog, options?: ReferenceOptions) {
  let result = '';
  let cursor = 0;
  for (const span of listReferenceSpans(text, catalog, options)) {
    result += text.slice(cursor, span.start);
    result +=
      span.source === 'link'
        ? text.slice(span.start, span.end)
        : `[${escapeLabel(span.label)}](${serializeReference(span.reference)})`;
    cursor = span.end;
  }
  return result + text.slice(cursor);
}

export const STAGE_WORDS: Record<TaskStage, string> = {
  triage: 'starting',
  waiting_on_tasks: 'waiting on another task',
  planning: 'planning',
  awaiting_plan: 'plan to approve',
  building: 'building',
  checking: 'checking',
  reviewing: 'agent review',
  fixing: 'fixing',
  awaiting_review: 'changes to review',
  shipping: 'pull request open',
  awaiting_merge: 'ready to merge',
  answering: 'answering',
  investigating: 'investigating',
  researching: 'researching',
  operating: 'running the operation',
  awaiting_proposal: 'change to approve',
  awaiting_operation: 'operation to confirm',
  merged: 'merged',
  done: 'done',
  cancelled: 'cancelled',
};

export function resolveReferenceCatalog(state: ShinsaState): ReferenceCatalog {
  const tasks = Object.values(state.tasks).filter((task) => task.stage !== 'cancelled');
  return {
    tasks: tasks.map((task) => ({ id: task.id, title: task.title })),
    pullRequests: tasks.flatMap((task) =>
      task.pullRequest
        ? [
            {
              number: task.pullRequest.number,
              repo: task.repoId ? (state.repos[task.repoId]?.name ?? null) : null,
              taskId: task.id,
            },
          ]
        : []
    ),
  };
}

function matchesQuery(state: ShinsaState, task: Task, words: string[]) {
  const repo = task.repoId ? state.repos[task.repoId]?.name : '';
  const haystack = [
    task.id,
    task.handle ?? '',
    task.title,
    task.request,
    task.branch ?? '',
    repo ?? '',
    task.pullRequest ? `#${task.pullRequest.number}` : '',
  ]
    .join(' ')
    .toLowerCase();
  return words.every((word) => haystack.includes(word));
}

export function serializeTaskReferences(state: ShinsaState, query: string, limit = 20) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const tasks = Object.values(state.tasks)
    .filter((task) => task.stage !== 'cancelled' && matchesQuery(state, task, words))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, limit);
  if (tasks.length === 0) return 'No task matches. Try fewer words.';
  return tasks
    .map((task) => {
      const repo = task.repoId ? state.repos[task.repoId] : undefined;
      const parts = [
        `${task.handle ? `${task.handle} ` : ''}[${task.title}](${serializeReference({ kind: 'task', id: task.id })})`,
        STAGE_WORDS[task.stage],
        repo ? `repository ${repo.name}` : '',
        task.branch ? `branch ${task.branch}` : '',
        task.pullRequest
          ? `[#${task.pullRequest.number}](${serializeReference({ kind: 'pr', repo: repo?.name ?? null, number: task.pullRequest.number })}) ${task.pullRequest.state}`
          : '',
      ];
      return `- ${parts.filter(Boolean).join(' · ')}`;
    })
    .join('\n');
}
