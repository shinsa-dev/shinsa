import {
  type ChatEntry,
  DomainError,
  isTaskSettled,
  listMergeSteps,
  listOpenGates,
  listProjectRepos,
  listWaitsOn,
  type Run,
  SETTINGS_KEYS,
  type ShinsaState,
  STAGE_WORDS,
  selectTaskByHandle,
  serializeTaskDetail,
  type Task,
} from '@shinsa/core';
import type { Transcripts } from '../agents/transcripts/index.ts';
import type { Engine } from '../runtime/engine.ts';

export interface ReadRoute {
  method: 'GET';
  pattern: RegExp;
  respond: (match: RegExpExecArray, request: Request) => Promise<Response>;
}

type TaskFilter = 'open' | 'needs_you' | 'settled' | 'all';

const TASK_FILTERS = new Set<TaskFilter>(['open', 'needs_you', 'settled', 'all']);

const DEFAULT_LIMIT = 50;

const MAX_LIMIT = 500;

const ACTIVITY_SHOWN = 30;

const CHAT_KINDS = new Set<ChatEntry['type']>([
  'user',
  'agent',
  'tool_call',
  'tool_result',
  'status',
  'error',
  'notice',
]);

const DEFAULT_CHAT_KINDS: ChatEntry['type'][] = ['user', 'agent', 'error'];

function readLimit(url: URL, fallback = DEFAULT_LIMIT) {
  const raw = url.searchParams.get('limit');
  const value = raw === null ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new DomainError('limit_invalid', 'limit must be a whole number of 1 or more.');
  }
  return Math.min(value, MAX_LIMIT);
}

function readFilter(url: URL): TaskFilter {
  const raw = url.searchParams.get('status') ?? 'open';
  if (!TASK_FILTERS.has(raw as TaskFilter)) {
    throw new DomainError('status_invalid', `status must be one of ${[...TASK_FILTERS].join(', ')}.`);
  }
  return raw as TaskFilter;
}

function selectDecision(state: ShinsaState, task: Task) {
  const gate = listOpenGates(state, task.id)[0];
  return gate ? { gateId: gate.id, type: gate.type, title: gate.title } : null;
}

export function resolveTaskView(state: ShinsaState, task: Task, base: string) {
  const repo = task.repoId ? state.repos[task.repoId] : undefined;
  const pullRequest = task.pullRequest;
  return {
    id: task.id,
    handle: task.handle ?? null,
    title: task.title,
    stage: task.stage,
    status: STAGE_WORDS[task.stage],
    stageReason: task.stageReason,
    priority: task.priority,
    mode: task.mode ?? 'build',
    repo: repo?.name ?? null,
    branch: task.branch,
    pullRequest: pullRequest
      ? {
          number: pullRequest.number,
          state: pullRequest.state,
          checks: pullRequest.checks,
          url: pullRequest.url,
        }
      : null,
    decision: selectDecision(state, task),
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    url: `${base}/tasks/${task.handle ?? task.id}`,
  };
}

function isListed(state: ShinsaState, task: Task, filter: TaskFilter) {
  if (filter === 'all') return true;
  if (filter === 'settled') return isTaskSettled(task);
  if (isTaskSettled(task)) return false;
  return filter === 'open' || selectDecision(state, task) !== null;
}

function matchesQuery(state: ShinsaState, task: Task, words: string[]) {
  const repo = task.repoId ? (state.repos[task.repoId]?.name ?? '') : '';
  const haystack = [task.id, task.handle ?? '', task.title, task.request, task.branch ?? '', repo]
    .join(' ')
    .toLowerCase();
  return words.every((word) => haystack.includes(word));
}

function findTaskByRef(state: ShinsaState, ref: string) {
  const exact = state.tasks[ref] ?? selectTaskByHandle(state, ref);
  if (exact) return exact;
  const lower = ref.toLowerCase();
  const matches = Object.values(state.tasks).filter(
    (task) => task.id.startsWith(ref) || task.title.toLowerCase() === lower
  );
  if (matches.length === 1 && matches[0]) return matches[0];
  if (matches.length > 1) {
    throw new DomainError('task_ambiguous', `“${ref}” matches ${matches.length} tasks. Use the full id.`);
  }
  throw new DomainError('task_not_found', `No task ${ref}. \`shinsa tasks list\` lists them.`);
}

function resolveRunView(run: Run) {
  return {
    id: run.id,
    role: run.role,
    phaseIndex: run.phaseIndex ?? null,
    provider: run.provider,
    model: run.model,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    outcome: run.outcome,
    summary: run.summary,
    account: run.account?.email ?? run.account?.id ?? null,
    delegation: run.delegation
      ? { title: run.delegation.title, parentRunId: run.delegation.parentRunId, depth: run.delegation.depth }
      : null,
  };
}

function listTaskRuns(state: ShinsaState, taskId: string) {
  return Object.values(state.runs)
    .filter((run) => run.taskId === taskId)
    .sort((a, b) => a.startedAt - b.startedAt);
}

function readKinds(url: URL) {
  const raw = url.searchParams.get('kinds');
  if (!raw) return new Set(DEFAULT_CHAT_KINDS);
  const kinds = raw.split(',').map((kind) => kind.trim());
  for (const kind of kinds) {
    if (!CHAT_KINDS.has(kind as ChatEntry['type'])) {
      throw new DomainError('kinds_invalid', `kinds are ${[...CHAT_KINDS].join(', ')}.`);
    }
  }
  return new Set(kinds as ChatEntry['type'][]);
}

function readIndex(url: URL, key: string) {
  const raw = url.searchParams.get(key);
  if (raw === null) return null;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < -1)
    throw new DomainError(`${key}_invalid`, `${key} must be an index.`);
  return value;
}

function resolveChatPage(transcripts: Transcripts, runs: Run[], url: URL) {
  const runId = url.searchParams.get('run');
  const kinds = readKinds(url);
  const limit = readLimit(url);
  const after = readIndex(url, 'after');
  const all = runs
    .filter((run) => !runId || run.id === runId)
    .flatMap((run) => transcripts.listEntries(run.id).map((entry) => ({ ...entry, runId: run.id })))
    .map((entry, index) => ({ index, ...entry }))
    .filter((entry) => kinds.has(entry.type));
  const page =
    after === null ? all.slice(-limit) : all.filter((entry) => entry.index > after).slice(0, limit);
  const last = page.at(-1);
  const more = last !== undefined && all.some((entry) => entry.index > last.index);
  return { entries: page, next: more ? last.index : null };
}

function listProjectViews(state: ShinsaState) {
  return Object.values(state.projects).map((project) => ({
    ...project,
    repos: listProjectRepos(state, project.id).map((repo) => ({
      id: repo.id,
      name: repo.name,
      path: repo.path,
    })),
  }));
}

function listActionViews(state: ShinsaState) {
  return (state.onBehalfActions ?? []).map((action) => {
    const from = action.byTaskId ? state.tasks[action.byTaskId] : undefined;
    return { ...action, byTask: from ? (from.handle ?? `“${from.title}”`) : null };
  });
}

export function createReadRoutes(engine: Engine, transcripts: Transcripts): ReadRoute[] {
  const respond = (body: unknown) => Promise.resolve(Response.json(body));

  function respondTasks(url: URL) {
    const state = engine.state;
    const base = url.origin;
    const filter = readFilter(url);
    const words = (url.searchParams.get('q') ?? '').toLowerCase().split(/\s+/).filter(Boolean);
    const repo = url.searchParams.get('repo');
    const tasks = Object.values(state.tasks)
      .filter((task) => isListed(state, task, filter) && matchesQuery(state, task, words))
      .filter((task) => !repo || task.repoId === repo || state.repos[task.repoId ?? '']?.name === repo)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, readLimit(url))
      .map((task) => resolveTaskView(state, task, base));
    return respond({ tasks });
  }

  function respondTask(ref: string, url: URL) {
    const state = engine.state;
    const task = findTaskByRef(state, ref);
    return respond({
      task: resolveTaskView(state, task, url.origin),
      request: task.request,
      plan: task.plan
        ? {
            version: task.plan.version,
            approved: Boolean(task.plan.approvedAt),
            document: task.plan.document,
          }
        : null,
      summary: task.summary,
      result: task.result ?? null,
      findings: task.findings,
      mergeSteps: listMergeSteps(task),
      watchdogs: task.watchdogs ?? [],
      gates: listOpenGates(state, task.id),
      waitsOn: listWaitsOn(state, task).map((other) => ({ id: other.id, title: other.title })),
      runs: listTaskRuns(state, task.id).map(resolveRunView),
      suggestions: task.suggestions ?? [],
      activity: task.activity.slice(-ACTIVITY_SHOWN),
      text: serializeTaskDetail(state, task.id),
    });
  }

  function respondChat(ref: string, url: URL) {
    const state = engine.state;
    const task = findTaskByRef(state, ref);
    const runs = listTaskRuns(state, task.id);
    return respond({
      taskId: task.id,
      runs: runs.map(resolveRunView),
      ...resolveChatPage(transcripts, runs, url),
    });
  }

  function respondDelegations(url: URL) {
    const state = engine.state;
    const ref = url.searchParams.get('task');
    const taskId = ref ? findTaskByRef(state, ref).id : null;
    const delegations = Object.values(state.runs)
      .filter((run) => run.delegation && (!taskId || run.taskId === taskId))
      .sort((a, b) => a.startedAt - b.startedAt)
      .map((run) => ({ taskId: run.taskId, ...resolveRunView(run) }));
    return respond({ delegations });
  }

  return [
    {
      method: 'GET',
      pattern: /^\/api\/tasks$/,
      respond: (_match, request) => respondTasks(new URL(request.url)),
    },
    {
      method: 'GET',
      pattern: /^\/api\/tasks\/([^/]+)$/,
      respond: ([, id = ''], request) => respondTask(decodeURIComponent(id), new URL(request.url)),
    },
    {
      method: 'GET',
      pattern: /^\/api\/tasks\/([^/]+)\/chat$/,
      respond: ([, id = ''], request) => respondChat(decodeURIComponent(id), new URL(request.url)),
    },
    {
      method: 'GET',
      pattern: /^\/api\/settings$/,
      respond: () => respond({ settings: engine.state.settings, keys: SETTINGS_KEYS }),
    },
    {
      method: 'GET',
      pattern: /^\/api\/repos$/,
      respond: () => respond({ repos: Object.values(engine.state.repos) }),
    },
    {
      method: 'GET',
      pattern: /^\/api\/projects$/,
      respond: () => respond({ projects: listProjectViews(engine.state), focus: engine.state.focus }),
    },
    {
      method: 'GET',
      pattern: /^\/api\/schedules$/,
      respond: () => respond({ schedules: Object.values(engine.state.schedules) }),
    },
    {
      method: 'GET',
      pattern: /^\/api\/delegations$/,
      respond: (_match, request) => respondDelegations(new URL(request.url)),
    },
    {
      method: 'GET',
      pattern: /^\/api\/activity$/,
      respond: () => respond({ actions: listActionViews(engine.state) }),
    },
  ];
}
