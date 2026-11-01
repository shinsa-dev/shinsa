import { isTaskSettled } from '../domain/stages.ts';
import type { Activity, Evidence, Gate, Task } from '../domain/types.ts';
import type { ShinsaState } from '../state/project.ts';
import { type EntryChange, resolveEntryChange, type StatePatch } from './patch.ts';
import { serializeRun, serializeState, type WireRun, type WireState, type WireTask } from './runs.ts';

export interface TaskDetail {
  taskId: string;
  seq: number;
  task: Task | null;
  runs: Record<string, WireRun>;
  gates: Record<string, Gate>;
  evidence: Record<string, Evidence>;
}

export interface ViewPatch {
  patch: StatePatch;
  summarized: ReadonlySet<string>;
}

type TaskRecordKey = 'runs' | 'gates' | 'evidence';

type Fields = Record<string, unknown>;

const TASK_RECORDS: readonly TaskRecordKey[] = ['runs', 'gates', 'evidence'];

const NONE: never[] = [];

const EMPTIED_TASK_FIELDS: Partial<Record<keyof Task, null | never[]>> = {
  plan: null,
  report: null,
  coverage: null,
  phaseReports: NONE,
  findings: NONE,
  overlaps: NONE,
  planHistory: NONE,
  iterations: NONE,
  dismissedFindings: NONE,
  reviewDisagreements: NONE,
};

const DROPPED_RUN_FIELDS: readonly (keyof WireRun)[] = [
  'feedback',
  'compactions',
  'continuations',
  'silence',
  'cohort',
  'waitingOn',
  'fork',
  'failure',
];

const TASK_SUMMARIES = new WeakMap<Task, WireTask>();

const ACTIVITY_SUMMARIES = new WeakMap<Activity[], Activity[]>();

const RUN_SUMMARIES = new WeakMap<WireRun, WireRun>();

function selectNewestConversation(activity: Activity[]) {
  return activity
    .filter((entry) => entry.actor === 'agent' && entry.runId)
    .reduce<Activity | null>((newest, entry) => (newest && newest.at >= entry.at ? newest : entry), null);
}

function summarizeActivity(activity: Activity[]) {
  const known = ACTIVITY_SUMMARIES.get(activity);
  if (known) return known;
  const last = activity.at(-1);
  const conversation = selectNewestConversation(activity);
  const summary = activity.filter((entry) => entry === last || entry === conversation);
  ACTIVITY_SUMMARIES.set(activity, summary);
  return summary;
}

export function summarizeTask(task: Task): WireTask {
  const known = TASK_SUMMARIES.get(task);
  if (known) return known;
  const summary: Fields = { ...task, activity: summarizeActivity(task.activity), summarized: true };
  for (const [key, empty] of Object.entries(EMPTIED_TASK_FIELDS)) {
    if (Object.hasOwn(task, key)) summary[key] = empty;
  }
  const wire = summary as unknown as WireTask;
  TASK_SUMMARIES.set(task, wire);
  return wire;
}

export function summarizeRun(run: WireRun): WireRun {
  const known = RUN_SUMMARIES.get(run);
  if (known) return known;
  const summary: Fields = { ...run, summary: null };
  for (const key of DROPPED_RUN_FIELDS) delete summary[key];
  const attempt = run.attempts?.at(-1);
  if (attempt) {
    const { cwd: _cwd, ...kept } = attempt;
    summary.attempts = [{ ...kept, handoff: null }];
  }
  const wire = summary as unknown as WireRun;
  RUN_SUMMARIES.set(run, wire);
  return wire;
}

export function listSummarizedTasks(state: ShinsaState): Set<string> {
  return new Set(
    Object.values(state.tasks)
      .filter((task) => isTaskSettled(task))
      .map((task) => task.id)
  );
}

function viewTaskEntry(
  key: TaskRecordKey,
  entry: WireRun | Gate | Evidence | undefined,
  summarized: ReadonlySet<string>
) {
  if (!entry || !summarized.has(entry.taskId)) return entry;
  if (key === 'runs') return summarizeRun(entry as WireRun);
  if (key === 'gates') return (entry as Gate).status === 'open' ? entry : undefined;
  return undefined;
}

function viewRecord<T extends WireRun | Gate | Evidence>(
  key: TaskRecordKey,
  record: Record<string, T>,
  summarized: ReadonlySet<string>
) {
  const view: Record<string, T> = {};
  for (const [id, entry] of Object.entries(record)) {
    const viewed = viewTaskEntry(key, entry, summarized);
    if (viewed) view[id] = viewed as T;
  }
  return view;
}

export function serializeViewState(state: ShinsaState, summarized: ReadonlySet<string>): WireState {
  const wire = serializeState(state);
  if (summarized.size === 0) return wire;
  const tasks: Record<string, WireTask> = {};
  for (const [id, task] of Object.entries(state.tasks)) {
    tasks[id] = summarized.has(id) ? summarizeTask(task) : task;
  }
  return {
    ...wire,
    tasks,
    runs: viewRecord('runs', wire.runs, summarized),
    gates: viewRecord('gates', wire.gates, summarized),
    evidence: viewRecord('evidence', wire.evidence, summarized),
  };
}

function readTask(state: ShinsaState, id: string) {
  return Object.hasOwn(state.tasks, id) ? state.tasks[id] : undefined;
}

function readTaskEntry(state: ShinsaState, key: TaskRecordKey, id: string) {
  if (key === 'runs') {
    const run = Object.hasOwn(state.runs, id) ? state.runs[id] : undefined;
    return run && serializeRun(run);
  }
  const record: Record<string, Gate | Evidence> = state[key];
  return Object.hasOwn(record, id) ? record[id] : undefined;
}

function viewTask(task: Task | undefined, summarized: ReadonlySet<string>) {
  return task && summarized.has(task.id) ? summarizeTask(task) : task;
}

function listTouchedTasks(
  previous: ShinsaState,
  next: ShinsaState,
  patch: StatePatch,
  summarized: ReadonlySet<string>
) {
  const touched = new Set<string>();
  for (const id of Object.keys(patch.records.tasks ?? {})) {
    if (summarized.has(id)) touched.add(id);
  }
  for (const key of TASK_RECORDS) {
    for (const id of Object.keys(patch.records[key] ?? {})) {
      const taskId = (readTaskEntry(next, key, id) ?? readTaskEntry(previous, key, id))?.taskId;
      if (taskId !== undefined && summarized.has(taskId)) touched.add(taskId);
    }
  }
  return touched;
}

function writeChange(entries: Record<string, EntryChange>, id: string, change: EntryChange | null) {
  if (change) entries[id] = change;
  else delete entries[id];
}

export function resolveViewPatch(
  patch: StatePatch,
  previous: ShinsaState,
  next: ShinsaState,
  summarized: ReadonlySet<string>
): ViewPatch {
  const touched = listTouchedTasks(previous, next, patch, summarized);
  if (touched.size === 0) return { patch, summarized };
  const reopened = [...touched].filter((id) => {
    const task = readTask(next, id);
    return !task || !isTaskSettled(task);
  });
  const kept = new Set([...summarized].filter((id) => !reopened.includes(id)));
  const records: StatePatch['records'] = { ...patch.records };
  const tasks = { ...records.tasks };
  for (const id of Object.keys(tasks)) {
    if (!touched.has(id)) continue;
    writeChange(
      tasks,
      id,
      resolveEntryChange(viewTask(readTask(previous, id), summarized), viewTask(readTask(next, id), kept))
    );
  }
  records.tasks = tasks;
  for (const key of TASK_RECORDS) {
    const entries = { ...records[key] };
    for (const id of Object.keys(entries)) {
      const before = readTaskEntry(previous, key, id);
      const after = readTaskEntry(next, key, id);
      const taskId = (after ?? before)?.taskId;
      if (taskId === undefined || !touched.has(taskId)) continue;
      writeChange(
        entries,
        id,
        resolveEntryChange(viewTaskEntry(key, before, summarized), viewTaskEntry(key, after, kept))
      );
    }
    const record: Record<string, WireRun | Gate | Evidence> = key === 'runs' ? next.runs : next[key];
    for (const [id, entry] of Object.entries(record)) {
      if (!reopened.includes(entry.taskId) || Object.hasOwn(entries, id)) continue;
      const after = readTaskEntry(next, key, id);
      writeChange(
        entries,
        id,
        resolveEntryChange(viewTaskEntry(key, readTaskEntry(previous, key, id), summarized), after)
      );
    }
    records[key] = entries;
  }
  for (const key of ['tasks', ...TASK_RECORDS] as const) {
    if (Object.keys(records[key] ?? {}).length === 0) delete records[key];
  }
  return { patch: { ...patch, records }, summarized: kept };
}

export function resolveTaskDetail(state: ShinsaState, taskId: string): TaskDetail {
  const pick = <T extends { taskId: string }>(record: Record<string, T>) =>
    Object.fromEntries(Object.entries(record).filter(([, entry]) => entry.taskId === taskId));
  return {
    taskId,
    seq: state.seq,
    task: readTask(state, taskId) ?? null,
    runs: pick(serializeState(state).runs),
    gates: pick(state.gates),
    evidence: pick(state.evidence),
  };
}

function replaceTaskEntries<T extends { taskId: string }>(
  record: Record<string, T>,
  taskId: string,
  entries: Record<string, T>
) {
  const kept = Object.entries(record).filter(([, entry]) => entry.taskId !== taskId);
  return { ...Object.fromEntries(kept), ...entries };
}

export function applyTaskDetail(state: WireState, detail: TaskDetail): WireState | null {
  if (detail.seq !== state.seq) return null;
  const tasks = { ...state.tasks };
  if (detail.task) tasks[detail.taskId] = detail.task;
  else delete tasks[detail.taskId];
  return {
    ...state,
    tasks,
    runs: replaceTaskEntries(state.runs, detail.taskId, detail.runs),
    gates: replaceTaskEntries(state.gates, detail.taskId, detail.gates),
    evidence: replaceTaskEntries(state.evidence, detail.taskId, detail.evidence),
  };
}
