import {
  type ChatEntry,
  MESSAGE_KINDS,
  type MessageKind,
  ROUND_SHIPPINGS,
  type RoundShipping,
  SHARE_LIMITS,
  type ShareLimit,
  TASK_PRIORITIES,
  type TaskDiff,
} from '@shinsa/core';
import { type Display, describeTable, type Tone } from '../terminal/index.ts';
import type { FieldSpec, Values } from './fields.ts';
import {
  findAccount,
  findTaskId,
  findTaskIds,
  readTask,
  resolveOptionalAccount,
  resolveOptionalProjectId,
  resolveOptionalRepoId,
  type TaskDetail,
  type TaskView,
} from './resolve.ts';
import { defineAction, defineCommand, defineRead, encode, readValue, type SurfaceSpec } from './spec.ts';

export const TASK_FIELD: FieldSpec = {
  name: 'task',
  kind: 'text',
  positional: 'one',
  required: true,
  description: 'The task: its handle (SW-142), its id, the start of its id, or its exact title.',
};

const PRIORITY_FIELD: FieldSpec = {
  name: 'priority',
  kind: 'choice',
  choices: TASK_PRIORITIES,
  description: 'low, normal, high or urgent.',
};

const TASK_FILTERS = ['open', 'needs_you', 'settled', 'all'] as const;

const OPEN_TARGETS = ['editor', 'terminal', 'finder'] as const;

interface ChatPage {
  taskId: string;
  runs: { id: string; role: string }[];
  entries: (ChatEntry & { index: number; runId: string })[];
  next: number | null;
}

const PAUSED_GATES: ReadonlySet<string> = new Set(['failure', 'configuration', 'sign_in']);

const SETTLED_TONES: Partial<Record<TaskView['stage'], Tone>> = {
  merged: 'success',
  done: 'success',
  cancelled: 'dim',
};

function resolveTaskTone(task: TaskView): Tone {
  if (task.decision) return PAUSED_GATES.has(task.decision.type) ? 'danger' : 'warning';
  return SETTLED_TONES[task.stage] ?? 'accent';
}

function formatTasks(tasks: TaskView[], display: Display) {
  if (tasks.length === 0) return 'No tasks.';
  const repos = tasks.some((task) => task.repo);
  const rows = tasks.map((task) => [
    { text: task.handle ?? task.id, tone: 'bold' as const },
    task.title,
    { text: task.decision ? task.decision.title : task.status, tone: resolveTaskTone(task) },
    ...(repos ? [{ text: task.repo ?? '', tone: 'dim' as const }] : []),
  ]);
  const headers = ['Task', 'Title', 'Status', ...(repos ? ['Repository'] : [])];
  return describeTable(display, { headers, rows }).join('\n');
}

function describeEntry(entry: ChatPage['entries'][number], roles: Map<string, string>) {
  const role = roles.get(entry.runId) ?? 'agent';
  switch (entry.type) {
    case 'user':
      return `#${entry.index} ${entry.from === 'you' ? 'you' : 'Shinsa'} → ${role}: ${entry.text}`;
    case 'agent':
      return `#${entry.index} ${role}${entry.phase === 'final' ? '' : ' (working)'}: ${entry.text}`;
    case 'error':
      return `#${entry.index} ${role} failed: ${entry.text}`;
    default:
      return `#${entry.index} ${role} ${entry.type}: ${JSON.stringify(entry)}`;
  }
}

function formatChat(page: ChatPage) {
  const roles = new Map(page.runs.map((run) => [run.id, run.role]));
  const lines = page.entries.map((entry) => describeEntry(entry, roles));
  if (lines.length === 0) lines.push('Nothing in the chat yet.');
  if (page.next !== null) lines.push(`More after #${page.next}: add --after ${page.next}.`);
  return lines.join('\n');
}

function formatDiff(diff: TaskDiff) {
  if (diff.files.length === 0) return `No changes against ${diff.base}.`;
  return [
    `Changes against ${diff.base}:`,
    ...diff.files.map(
      (file) => `  ${file.status.padEnd(8)} ${file.path}  +${file.additions} -${file.deletions}`
    ),
  ].join('\n');
}

function readList(values: Values, name: string) {
  return (values[name] as string[] | undefined) ?? [];
}

async function buildProjectChoice(client: Parameters<SurfaceSpec['run']>[0], values: Values) {
  if (values.project === undefined) return {};
  const project = readValue(values, 'project');
  return { projectId: await resolveOptionalProjectId(client, project === 'none' ? '' : project) };
}

async function buildTaskCreate(values: Values, client: Parameters<SurfaceSpec['run']>[0]) {
  const account = await resolveOptionalAccount(client, readValue(values, 'account'));
  const waitsOn = await findTaskIds(client, readList(values, 'after'));
  const forkFrom = readValue(values, 'forkFrom');
  const [forkOf] = await findTaskIds(client, forkFrom ? [forkFrom] : []);
  return {
    type: 'task.create' as const,
    request: readValue(values, 'request'),
    repoId: await resolveOptionalRepoId(client, readValue(values, 'repo')),
    ...(await buildProjectChoice(client, values)),
    ...(values.priority ? { priority: values.priority as (typeof TASK_PRIORITIES)[number] } : {}),
    ...(values.planFirst ? { planFirst: true } : {}),
    ...(values.backlog ? { backlog: true } : {}),
    ...(values.ask ? { mode: 'ask' as const } : {}),
    ...(waitsOn.length > 0 ? { waitsOn } : {}),
    ...(forkOf ? { forkOf } : {}),
    ...(account ? { account } : {}),
  };
}

export const TASK_SPECS: SurfaceSpec[] = [
  defineRead<{ tasks: TaskView[] }>({
    path: ['tasks', 'list'],
    summary: 'List tasks, most recently changed first.',
    fields: [
      {
        name: 'status',
        kind: 'choice',
        choices: TASK_FILTERS,
        description: 'open (the default), needs_you, settled or all.',
      },
      {
        name: 'query',
        kind: 'text',
        description: 'Words that must all appear in the title, request, branch or repository.',
      },
      { name: 'repo', kind: 'text', description: 'Only tasks in this repository (name or id).' },
      { name: 'limit', kind: 'integer', description: 'At most this many tasks (50 by default).' },
    ],
    request: (values) => {
      const params = new URLSearchParams();
      for (const [key, name] of [
        ['status', 'status'],
        ['q', 'query'],
        ['repo', 'repo'],
        ['limit', 'limit'],
      ] as const) {
        if (values[name] !== undefined) params.set(key, String(values[name]));
      }
      const query = params.toString();
      return query ? `/api/tasks?${query}` : '/api/tasks';
    },
    format: ({ tasks }, _values, display) => formatTasks(tasks, display),
  }),
  defineRead<TaskDetail>({
    path: ['tasks', 'show'],
    summary: 'Show a task: its state, plan, open decisions and recent activity.',
    fields: [TASK_FIELD],
    request: (values) => `/api/tasks/${encode(values.task)}`,
    format: (detail) => detail.text,
  }),
  defineRead<ChatPage>({
    path: ['tasks', 'chat'],
    summary: "Read a task's chat: your messages, the agents' replies and, on request, their tool calls.",
    fields: [
      TASK_FIELD,
      { name: 'run', kind: 'text', description: 'Only this run.' },
      {
        name: 'kinds',
        kind: 'list',
        description: 'Entry kinds: user, agent, error (the default), tool_call, tool_result, status, notice.',
      },
      { name: 'after', kind: 'integer', description: 'Entries after this index, oldest first.' },
      {
        name: 'limit',
        kind: 'integer',
        description: 'At most this many entries (50 by default; the latest without after).',
      },
    ],
    request: (values) => {
      const params = new URLSearchParams();
      if (values.run) params.set('run', String(values.run));
      if (values.kinds) params.set('kinds', readList(values, 'kinds').join(','));
      if (values.after !== undefined) params.set('after', String(values.after));
      if (values.limit !== undefined) params.set('limit', String(values.limit));
      const query = params.toString();
      return `/api/tasks/${encode(values.task)}/chat${query ? `?${query}` : ''}`;
    },
    format: formatChat,
  }),
  defineRead<TaskDiff>({
    path: ['tasks', 'diff'],
    summary: 'List the files a task changed against its base branch.',
    fields: [TASK_FIELD],
    request: async (values, client) =>
      `/api/tasks/${encode(await findTaskId(client, readValue(values, 'task')))}/diff`,
    format: formatDiff,
  }),
  defineCommand({
    path: ['tasks', 'create'],
    summary: 'Create a task. Shinsa classifies it, plans it and builds it.',
    command: 'task.create',
    agentTool: 'create_task',
    fields: [
      {
        name: 'request',
        kind: 'text',
        positional: 'rest',
        required: true,
        description: 'What should be done. The first line becomes the title.',
      },
      {
        name: 'repo',
        kind: 'text',
        description: 'The repository (name or id). Triage picks one when left out.',
      },
      {
        name: 'project',
        kind: 'text',
        description:
          'The project (key, name or id), or none. Left out, it is the repository’s project, else the one in focus.',
      },
      PRIORITY_FIELD,
      {
        name: 'planFirst',
        kind: 'boolean',
        description: 'Wait for you to approve the plan before building.',
      },
      {
        name: 'backlog',
        kind: 'boolean',
        description: 'Plan it now and keep it in the backlog until you start building it.',
      },
      {
        name: 'ask',
        kind: 'boolean',
        description: 'Only answer a question: no changes, branch or pull request.',
      },
      { name: 'after', kind: 'list', description: 'Tasks it waits on before it starts.' },
      {
        name: 'forkFrom',
        kind: 'text',
        description: 'A task to fork: the new task’s agent starts from a copy of its conversation.',
      },
      { name: 'account', kind: 'text', description: 'Run it on this Claude account (id or email).' },
    ],
    build: buildTaskCreate,
    done: () => 'Created the task. Shinsa brings it back when it needs a decision.',
  }),
  defineCommand({
    path: ['tasks', 'message'],
    summary: "Send a message to a task's agent. At an open decision it is your feedback, never an approval.",
    command: 'task.message',
    fields: [
      TASK_FIELD,
      { name: 'text', kind: 'text', positional: 'rest', required: true, description: 'The message.' },
      {
        name: 'as',
        kind: 'choice',
        choices: MESSAGE_KINDS,
        description:
          'feedback on the current round (a follow-up on a finished one), acknowledge for a message that needs nothing, new_round for new work in this task, or separate_task to suggest it as its own task. Left out, Shinsa decides.',
      },
    ],
    build: async (values, client) => {
      const kind = readValue(values, 'as');
      return {
        type: 'task.message',
        taskId: await findTaskId(client, readValue(values, 'task')),
        text: readValue(values, 'text'),
        ...(kind ? { kind: kind as MessageKind } : {}),
      };
    },
    done: () => 'Sent.',
  }),
  defineCommand({
    path: ['rounds', 'ship'],
    summary:
      'Choose how a round ships: onto the task’s open pull request, or as its own stacked pull request.',
    command: 'round.ship',
    fields: [
      TASK_FIELD,
      {
        name: 'round',
        kind: 'integer',
        positional: 'one',
        required: true,
        description: 'The round number, from `shinsa tasks show`.',
      },
      {
        name: 'how',
        kind: 'choice',
        choices: ROUND_SHIPPINGS,
        positional: 'one',
        required: true,
        description: 'onto_pull_request or stacked.',
      },
    ],
    build: async (values, client) => ({
      type: 'round.ship',
      taskId: await findTaskId(client, readValue(values, 'task')),
      number: values.round as number,
      shipping: readValue(values, 'how') as RoundShipping,
    }),
    done: () => 'Saved how the round ships.',
  }),
  defineCommand({
    path: ['rounds', 'update'],
    summary: 'Change what a queued round asks for, before it starts.',
    command: 'round.update',
    humanOnly: true,
    fields: [
      TASK_FIELD,
      {
        name: 'round',
        kind: 'integer',
        positional: 'one',
        required: true,
        description: 'The number of a round that waits to start, from `shinsa tasks show`.',
      },
      {
        name: 'text',
        kind: 'text',
        positional: 'rest',
        required: true,
        description: 'What the round asks for instead.',
      },
    ],
    build: async (values, client) => ({
      type: 'round.update',
      taskId: await findTaskId(client, readValue(values, 'task')),
      number: values.round as number,
      request: readValue(values, 'text'),
    }),
    done: () => 'Changed the queued round.',
  }),
  defineCommand({
    path: ['rounds', 'remove'],
    summary: 'Remove a queued round before it starts. The rounds after it move up.',
    command: 'round.remove',
    humanOnly: true,
    fields: [
      TASK_FIELD,
      {
        name: 'round',
        kind: 'integer',
        positional: 'one',
        required: true,
        description: 'The number of a round that waits to start, from `shinsa tasks show`.',
      },
    ],
    build: async (values, client) => ({
      type: 'round.remove',
      taskId: await findTaskId(client, readValue(values, 'task')),
      number: values.round as number,
    }),
    done: () => 'Removed the queued round.',
  }),
  defineCommand({
    path: ['rounds', 'send'],
    summary: 'Send a queued round to the current round now, as a message, instead of waiting.',
    command: 'round.send',
    humanOnly: true,
    fields: [
      TASK_FIELD,
      {
        name: 'round',
        kind: 'integer',
        positional: 'one',
        required: true,
        description: 'The number of a round that waits to start, from `shinsa tasks show`.',
      },
    ],
    build: async (values, client) => ({
      type: 'round.send',
      taskId: await findTaskId(client, readValue(values, 'task')),
      number: values.round as number,
    }),
    done: () => 'Sent the queued round to the current round.',
  }),
  defineCommand({
    path: ['tasks', 'retry'],
    summary: "Restart a paused task's current step with a fresh fix budget.",
    command: 'task.retry',
    fields: [
      TASK_FIELD,
      { name: 'account', kind: 'text', description: 'Run the step on this account (id or email).' },
    ],
    build: async (values, client) => {
      const account = await resolveOptionalAccount(client, readValue(values, 'account'));
      return {
        type: 'task.retry',
        taskId: await findTaskId(client, readValue(values, 'task')),
        ...(account ? { account } : {}),
      };
    },
    done: () => 'Retrying.',
  }),
  defineCommand({
    path: ['tasks', 'rerun'],
    summary: 'Run the current step again on a chosen Claude account.',
    command: 'task.retry',
    fields: [
      TASK_FIELD,
      {
        name: 'account',
        kind: 'text',
        positional: 'one',
        required: true,
        description: 'The account (id or email).',
      },
    ],
    build: async (values, client) => ({
      type: 'task.retry',
      taskId: await findTaskId(client, readValue(values, 'task')),
      account: await findAccount(client, readValue(values, 'account')),
    }),
    done: (values) => `Running this step again on ${readValue(values, 'account')}.`,
  }),
  defineCommand({
    path: ['tasks', 'cancel'],
    summary: 'Cancel a task. Its agents stop and its worktree is removed.',
    command: 'task.cancel',
    fields: [TASK_FIELD],
    build: async (values, client) => ({
      type: 'task.cancel',
      taskId: await findTaskId(client, readValue(values, 'task')),
    }),
    done: () => 'Cancelled.',
  }),
  defineCommand({
    path: ['tasks', 'share'],
    summary: 'Share a task by a link that reads it live from this machine: read-only, without its chat.',
    command: 'task.share',
    humanOnly: true,
    fields: [
      TASK_FIELD,
      {
        name: 'until',
        kind: 'choice',
        choices: SHARE_LIMITS,
        description:
          'How long it stays shared: until_done (until the task finishes), hour, day, week or none (until you stop it). Left out, the shareLimit setting.',
      },
    ],
    build: async (values, client) => {
      const limit = readValue(values, 'until');
      return {
        type: 'task.share',
        taskId: await findTaskId(client, readValue(values, 'task')),
        ...(limit ? { limit: limit as ShareLimit } : {}),
      };
    },
    done: () => 'Shared. Its link shows on the task in a moment.',
  }),
  defineCommand({
    path: ['tasks', 'unshare'],
    summary: 'Stop sharing a task. Its link stops working.',
    command: 'task.unshare',
    humanOnly: true,
    fields: [TASK_FIELD],
    build: async (values, client) => ({
      type: 'task.unshare',
      taskId: await findTaskId(client, readValue(values, 'task')),
    }),
    done: () => 'No longer shared.',
  }),
  defineCommand({
    path: ['tasks', 'duplicate'],
    summary: 'Close a task as a duplicate of another. It is cancelled and links the task it duplicates.',
    command: 'task.mark_duplicate',
    fields: [
      TASK_FIELD,
      {
        name: 'of',
        kind: 'text',
        required: true,
        description:
          'The task it duplicates: its handle (SW-142), its id, the start of its id, or its exact title.',
      },
    ],
    build: async (values, client) => ({
      type: 'task.mark_duplicate',
      taskId: await findTaskId(client, readValue(values, 'task')),
      duplicateOf: await findTaskId(client, readValue(values, 'of')),
    }),
    done: () => 'Closed as a duplicate.',
  }),
  defineCommand({
    path: ['tasks', 'not-duplicate'],
    summary: 'Start a task closed as a duplicate again. One that already worked starts a fresh round.',
    command: 'task.clear_duplicate',
    fields: [TASK_FIELD],
    build: async (values, client) => ({
      type: 'task.clear_duplicate',
      taskId: await findTaskId(client, readValue(values, 'task')),
    }),
    done: () => 'Started it again.',
  }),
  defineCommand({
    path: ['tasks', 'done'],
    summary: 'Mark a task as done without merging it.',
    command: 'task.complete',
    fields: [TASK_FIELD],
    build: async (values, client) => ({
      type: 'task.complete',
      taskId: await findTaskId(client, readValue(values, 'task')),
    }),
    done: () => 'Marked as done.',
  }),
  defineCommand({
    path: ['tasks', 'prioritize'],
    summary: 'Change how soon a task reaches you.',
    command: 'task.prioritize',
    fields: [TASK_FIELD, { ...PRIORITY_FIELD, positional: 'one', required: true }],
    build: async (values, client) => ({
      type: 'task.prioritize',
      taskId: await findTaskId(client, readValue(values, 'task')),
      priority: values.priority as (typeof TASK_PRIORITIES)[number],
    }),
    done: (values) => `Priority set to ${readValue(values, 'priority')}.`,
  }),
  defineCommand({
    path: ['tasks', 'wait-on'],
    summary: 'Make a task wait on other tasks. The list replaces the tasks it waits on now.',
    command: 'task.wait_on',
    fields: [
      TASK_FIELD,
      {
        name: 'waitsOn',
        kind: 'list',
        positional: 'rest',
        required: true,
        description: 'The tasks it waits on.',
      },
    ],
    build: async (values, client) => ({
      type: 'task.wait_on',
      taskId: await findTaskId(client, readValue(values, 'task')),
      waitsOn: await findTaskIds(client, readList(values, 'waitsOn')),
    }),
    done: () => 'Saved what it waits on.',
  }),
  defineCommand({
    path: ['tasks', 'stop-waiting'],
    summary: 'Stop a task waiting on other tasks.',
    command: 'task.wait_on',
    fields: [TASK_FIELD],
    build: async (values, client) => ({
      type: 'task.wait_on',
      taskId: await findTaskId(client, readValue(values, 'task')),
      waitsOn: [],
    }),
    done: () => 'It no longer waits on other tasks.',
  }),
  defineCommand({
    path: ['tasks', 'move-to-backlog'],
    summary: 'Keep a task in the backlog: its plan waits there until you start building it.',
    command: 'task.move_to_backlog',
    fields: [TASK_FIELD],
    build: async (values, client) => ({
      type: 'task.move_to_backlog',
      taskId: await findTaskId(client, readValue(values, 'task')),
    }),
    done: () => 'Moved to the backlog.',
  }),
  defineCommand({
    path: ['tasks', 'remove-from-backlog'],
    summary: 'Take a task out of the backlog: its plan waits for you in Needs you.',
    command: 'task.remove_from_backlog',
    fields: [TASK_FIELD],
    build: async (values, client) => ({
      type: 'task.remove_from_backlog',
      taskId: await findTaskId(client, readValue(values, 'task')),
    }),
    done: () => 'Removed from the backlog. Its plan now waits for your approval.',
  }),
  defineCommand({
    path: ['tasks', 'snooze'],
    summary:
      'Snooze a task: it keeps its step and its work, and leaves Needs you and Home until you unsnooze it.',
    command: 'task.snooze',
    fields: [TASK_FIELD],
    build: async (values, client) => ({
      type: 'task.snooze',
      taskId: await findTaskId(client, readValue(values, 'task')),
    }),
    done: () => 'Snoozed. It keeps working and stays out of Needs you until you unsnooze it.',
  }),
  defineCommand({
    path: ['tasks', 'unsnooze'],
    summary: 'Unsnooze a task: it shows again where it was, in Needs you when it waits for you.',
    command: 'task.unsnooze',
    fields: [TASK_FIELD],
    build: async (values, client) => ({
      type: 'task.unsnooze',
      taskId: await findTaskId(client, readValue(values, 'task')),
    }),
    done: () => 'Unsnoozed.',
  }),
  defineCommand({
    path: ['tasks', 'bind'],
    summary: 'Run a task on one Claude account, or on any account again.',
    command: 'task.bind_account',
    fields: [
      TASK_FIELD,
      {
        name: 'account',
        kind: 'text',
        positional: 'one',
        required: true,
        description: 'The account (id or email), or any.',
      },
    ],
    build: async (values, client) => {
      const account = readValue(values, 'account');
      return {
        type: 'task.bind_account',
        taskId: await findTaskId(client, readValue(values, 'task')),
        account: await resolveOptionalAccount(client, account === 'any' ? '' : account),
      };
    },
    done: () => 'Saved the account.',
  }),
  defineCommand({
    path: ['tasks', 'check-in-now'],
    summary: "Fire a waiting agent's next check-in now.",
    command: 'monitor.check_in_now',
    fields: [TASK_FIELD],
    build: async (values, client) => ({
      type: 'monitor.check_in_now',
      taskId: await findTaskId(client, readValue(values, 'task')),
    }),
    done: () => 'Checking in now.',
  }),
  defineCommand({
    path: ['tasks', 'resume-now'],
    summary: 'Resume a task that waits for a usage limit to reset, now.',
    command: 'usage_wait.resume_now',
    fields: [TASK_FIELD],
    build: async (values, client) => ({
      type: 'usage_wait.resume_now',
      taskId: await findTaskId(client, readValue(values, 'task')),
    }),
    done: () => 'Resuming.',
  }),
  defineCommand({
    path: ['tasks', 'auto-resume'],
    summary: 'Choose whether a task waiting for a usage limit resumes by itself at the reset.',
    command: 'usage_wait.change',
    fields: [
      TASK_FIELD,
      {
        name: 'resume',
        kind: 'boolean',
        positional: 'one',
        required: true,
        description: 'true to resume at the reset, false to wait for you.',
      },
    ],
    build: async (values, client) => ({
      type: 'usage_wait.change',
      taskId: await findTaskId(client, readValue(values, 'task')),
      autoResume: values.resume === true,
    }),
    done: (values) => (values.resume ? 'It resumes at the reset.' : 'It waits for you at the reset.'),
  }),
  defineAction({
    path: ['tasks', 'open'],
    summary: "Open a task's worktree in your editor, a terminal or Finder.",
    humanOnly: true,
    fields: [
      TASK_FIELD,
      {
        name: 'in',
        kind: 'choice',
        choices: OPEN_TARGETS,
        positional: 'one',
        description: 'editor (the default), terminal or finder.',
      },
    ],
    act: async (client, values) => {
      const detail = await readTask(client, readValue(values, 'task'));
      const data = await client.post<{ ok: boolean }>(`/api/tasks/${encode(detail.task.id)}/open`, {
        target: values.in ?? 'editor',
      });
      return { data, text: data.ok ? 'Opened.' : 'Could not open it.' };
    },
  }),
];
