import {
  type ChatBrowserAction,
  type ChatTool,
  type ChatToolArgs,
  capitalise,
  describeList,
  type ShinsaToolName,
} from '@shinsa/core';
import type { IconName } from '@shinsa/ui/components/icon';
import { formatCount } from '@/lib/format/count.ts';
import { describeSteps } from '@/lib/tasks/shapes.ts';

export interface ToolDescription {
  icon: IconName;
  verb: string;
  target: string | null;
  code: boolean;
  scope: string | null;
}

type ToolGroupKey = Exclude<ChatTool['kind'], 'shinsa'> | ShinsaToolName | 'surface';

const HANDOVER_TOOLS = new Set<ShinsaToolName>([
  'propose_plan',
  'complete_phase',
  'complete_fix',
  'report_review',
  'ask',
  'suggest_tasks',
  'remember',
  'answer',
  'report_diagnosis',
  'submit_report',
  'report_outcome',
  'report_watch',
  'report_intake',
  'reshape_task',
]);

export function isHandover(tool: ChatTool) {
  return tool.kind === 'shinsa' && HANDOVER_TOOLS.has(tool.name);
}

export function resolveGroupKey(tool: ChatTool): ToolGroupKey {
  if (tool.kind === 'mcp' && tool.server === 'shinsa') return 'surface';
  return tool.kind === 'shinsa' ? tool.name : tool.kind;
}

export function readString(args: ChatToolArgs | null, key: string) {
  const value = args?.[key];
  return typeof value === 'string' && value.trim() ? value : null;
}

export function readList(args: ChatToolArgs | null, key: string): ChatToolArgs[] {
  const value = args?.[key];
  return Array.isArray(value)
    ? value.filter((item): item is ChatToolArgs => Boolean(item) && typeof item === 'object')
    : [];
}

export function readStrings(args: ChatToolArgs | null, key: string): string[] {
  const value = args?.[key];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim() !== '')
    : [];
}

export function resolveShortPath(path: string) {
  const worktree = path.match(/\/worktrees\/[^/]+\/(.+)$/);
  if (worktree?.[1]) return worktree[1];
  const parts = path.split('/').filter(Boolean);
  return path.startsWith('/') && parts.length > 3 ? `…/${parts.slice(-3).join('/')}` : path;
}

function firstLine(text: string) {
  const line = text.split('\n').find((part) => part.trim()) ?? text;
  return line.trim();
}

export function humanize(name: string) {
  const joined = name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase())
    .join(' ');
  return capitalise(joined);
}

const PRIMARY_KEYS = ['url', 'query', 'question', 'title', 'name', 'path', 'text', 'description', 'id'];

function readPrimary(args: ChatToolArgs) {
  for (const key of PRIMARY_KEYS) {
    const value = readString(args, key);
    if (value) return firstLine(value);
  }
  return null;
}

function plain(icon: IconName, verb: string, target: string | null = null, scope: string | null = null) {
  return { icon, verb, target, code: false, scope };
}

function coded(icon: IconName, verb: string, target: string | null, scope: string | null = null) {
  return { icon, verb, target, code: true, scope };
}

const BROWSER: Record<ChatBrowserAction, { icon: IconName; verb: string }> = {
  navigate: { icon: 'IconGlobe', verb: 'Opened' },
  back: { icon: 'IconGlobe', verb: 'Went back a page' },
  click: { icon: 'IconCursorClick', verb: 'Clicked' },
  hover: { icon: 'IconCursorClick', verb: 'Hovered over' },
  drag: { icon: 'IconCursorClick', verb: 'Dragged' },
  select: { icon: 'IconCursorClick', verb: 'Picked an option in' },
  type: { icon: 'IconKeyboard', verb: 'Typed into' },
  fill: { icon: 'IconKeyboard', verb: 'Filled in a form' },
  press: { icon: 'IconKeyboard', verb: 'Pressed' },
  screenshot: { icon: 'IconCamera1', verb: 'Took a screenshot' },
  snapshot: { icon: 'IconWindowCursor', verb: 'Read the page' },
  find: { icon: 'IconMagnifyingGlass', verb: 'Looked on the page for' },
  resize: { icon: 'IconWindowCursor', verb: 'Resized the window to' },
  evaluate: { icon: 'IconCode', verb: 'Ran a script in the page' },
  wait: { icon: 'IconHourglass', verb: 'Waited for' },
  console: { icon: 'IconConsole', verb: 'Read the console' },
  network: { icon: 'IconGlobe', verb: 'Read the network requests' },
  tabs: { icon: 'IconBrowserTabs', verb: 'Switched tabs' },
  close: { icon: 'IconWindowCursor', verb: 'Closed the browser' },
  other: { icon: 'IconWindowCursor', verb: 'Used the browser' },
};

type PlainShinsaTool =
  | 'propose_plan'
  | 'complete_phase'
  | 'complete_fix'
  | 'report_review'
  | 'read_task'
  | 'list_repository_work'
  | 'list_services'
  | 'answer'
  | 'report_diagnosis'
  | 'submit_report'
  | 'report_outcome'
  | 'report_watch'
  | 'report_intake'
  | 'delegation_status'
  | 'delegation_cancel'
  | 'list_schedules'
  | 'delete_schedule';

const PLAIN_SHINSA: Record<PlainShinsaTool, { icon: IconName; verb: string }> = {
  propose_plan: { icon: 'IconMap', verb: 'Proposed the plan' },
  complete_phase: { icon: 'IconSend', verb: 'Handed over the phase' },
  complete_fix: { icon: 'IconSend', verb: 'Handed over the fix' },
  report_review: { icon: 'IconShieldCheck', verb: 'Reported the review' },
  read_task: { icon: 'IconFileText', verb: 'Read a task' },
  list_repository_work: { icon: 'IconFolders', verb: 'Listed the other work in the repository' },
  list_services: { icon: 'IconServer', verb: 'Listed the task’s services' },
  answer: { icon: 'IconSend', verb: 'Handed over the answer' },
  report_diagnosis: { icon: 'IconSend', verb: 'Reported the diagnosis' },
  submit_report: { icon: 'IconSend', verb: 'Wrote the report' },
  report_outcome: { icon: 'IconSend', verb: 'Reported the outcome' },
  report_watch: { icon: 'IconSend', verb: 'Reported the watchdog check' },
  report_intake: { icon: 'IconSend', verb: 'Reported what the watch found' },
  delegation_status: { icon: 'IconAgents', verb: 'Checked a delegation' },
  delegation_cancel: { icon: 'IconCircleX', verb: 'Stopped a delegation' },
  list_schedules: { icon: 'IconClock', verb: 'Listed the schedules' },
  delete_schedule: { icon: 'IconCircleX', verb: 'Deleted a schedule' },
};

function isPlainShinsaTool(name: ShinsaToolName): name is PlainShinsaTool {
  return name in PLAIN_SHINSA;
}

function describeShinsaWork(name: Exclude<ShinsaToolName, PlainShinsaTool>, args: ChatToolArgs) {
  switch (name) {
    case 'reshape_task': {
      const steps = readStrings(args, 'steps');
      if (steps.length > 0) return plain('IconSplit', 'Set the steps:', describeSteps(steps));
      return plain('IconSplit', 'Changed the kind of task');
    }
    case 'delegate_task':
      return plain(
        'IconAgents',
        'Delegated:',
        readString(args, 'title') ?? firstLine(readString(args, 'brief') ?? '')
      );
    case 'create_task':
      return plain('IconPlusSmall', 'Created a task:', firstLine(readString(args, 'request') ?? ''));
    case 'file_report':
      return plain('IconPlusSmall', 'Filed a report:', readString(args, 'title'));
    case 'split_task':
      return plain(
        'IconSplit',
        'Split the plan into',
        formatCount(readList(args, 'tasks').length, 'task', 'tasks')
      );
    case 'set_schedule':
      return plain(
        'IconClock',
        'Set a schedule:',
        readString(args, 'name') ?? firstLine(readString(args, 'message') ?? '')
      );
    default:
      return describeShinsaMessage(name, args);
  }
}

function describeShinsaMessage(
  name: Exclude<
    ShinsaToolName,
    | PlainShinsaTool
    | 'reshape_task'
    | 'delegate_task'
    | 'create_task'
    | 'file_report'
    | 'split_task'
    | 'set_schedule'
  >,
  args: ChatToolArgs
): ToolDescription {
  switch (name) {
    case 'ask':
      return plain('IconBubbleQuestion', 'Asked you:', readString(args, 'question'));
    case 'attach_evidence': {
      const check = readString(args, 'check');
      if (check) return plain('IconTestTube', 'Linked the check as evidence:', check);
      return plain('IconPaperclip1', 'Attached evidence:', readString(args, 'title'));
    }
    case 'remove_evidence':
      return plain('IconTrashCan', 'Removed evidence:', readString(args, 'reason'));
    case 'find_tasks': {
      const query = readString(args, 'query');
      return plain('IconMagnifyingGlass', query ? 'Looked up tasks:' : 'Looked up tasks', query);
    }
    case 'note':
      return plain('IconNote1', 'Left a note:', readString(args, 'note'));
    case 'wait_for':
      return plain('IconHourglass', 'Scheduled a check-in:', readString(args, 'notes'));
    case 'suggest_tasks': {
      const count = readList(args, 'tasks').length;
      return plain('IconLightbulbGlow', `Suggested ${formatCount(count, 'task', 'tasks')}`);
    }
    case 'remember':
      return plain('IconLightbulbGlow', 'Proposed a rule to remember:', readString(args, 'text'));
    case 'delegation_answer':
      return plain('IconBubbleText', 'Answered a delegated agent:', readString(args, 'answer'));
    case 'request_secret':
      return plain('IconShieldCheck', 'Asked you for a secret:', readString(args, 'label'));
    case 'run_service':
      return plain(
        'IconServer',
        SERVICE_VERBS[readString(args, 'action') ?? ''] ?? 'Ran a service:',
        readString(args, 'service')
      );
  }
}

const SERVICE_VERBS: Record<string, string> = {
  start: 'Started a service:',
  stop: 'Stopped a service:',
  restart: 'Restarted a service:',
};

function describeShinsa(name: ShinsaToolName, args: ChatToolArgs): ToolDescription {
  if (!isPlainShinsaTool(name)) return describeShinsaWork(name, args);
  const { icon, verb } = PLAIN_SHINSA[name];
  return plain(icon, verb);
}

export function describeTool(tool: ChatTool): ToolDescription {
  switch (tool.kind) {
    case 'read':
      return coded('IconFileText', 'Read', resolveShortPath(tool.path));
    case 'write':
      return coded('IconFileEdit', 'Wrote', resolveShortPath(tool.path));
    case 'edit':
      return coded('IconPencil', 'Edited', resolveShortPath(tool.path));
    case 'command':
      if (tool.action === 'output') return plain('IconConsole', 'Checked a command');
      if (tool.action === 'stop') return plain('IconConsole', 'Stopped a command');
      if (tool.description) return plain('IconConsole', firstLine(tool.description));
      return coded('IconConsole', 'Ran', firstLine(tool.command));
    case 'search': {
      const scope = tool.path ? `in ${resolveShortPath(tool.path)}` : null;
      if (tool.mode === 'list')
        return coded('IconMagnifyingGlass', 'Listed', tool.path && resolveShortPath(tool.path));
      if (tool.mode === 'files')
        return coded('IconMagnifyingGlass', 'Listed files matching', tool.query, scope);
      return coded('IconMagnifyingGlass', 'Searched for', tool.query, scope);
    }
    case 'fetch':
      return tool.url
        ? plain('IconGlobe', 'Opened', tool.url)
        : plain('IconGlobe', 'Searched the web for', tool.query);
    case 'browser': {
      const action = BROWSER[tool.action];
      if (tool.action === 'other') return plain(action.icon, humanize(tool.name));
      return {
        ...plain(action.icon, action.verb, tool.target && firstLine(tool.target)),
        code: tool.action === 'press',
      };
    }
    case 'task':
      return plain('IconRobot', 'Ran a subagent:', tool.description || null);
    case 'todo':
      return plain('IconChecklist', 'Updated the to-do list');
    case 'mcp':
      return plain('IconPlugin1', humanize(tool.name), readPrimary(tool.args), humanize(tool.server));
    case 'shinsa':
      return describeShinsa(tool.name, tool.args);
    case 'other':
      return plain('IconToolbox', `Used ${tool.name}`, readPrimary(tool.args));
  }
}

const PRESENT_VERB: Record<string, string> = {
  Read: 'Reading',
  Edited: 'Editing',
  Wrote: 'Writing',
  Ran: 'Running',
  'Checked a command': 'Checking a command',
  'Stopped a command': 'Stopping a command',
  'Searched for': 'Searching for',
  'Listed files matching': 'Listing files matching',
  Listed: 'Listing',
  Opened: 'Opening',
  'Searched the web for': 'Searching the web for',
  'Went back a page': 'Going back a page',
  Clicked: 'Clicking',
  'Hovered over': 'Hovering over',
  Dragged: 'Dragging',
  'Picked an option in': 'Picking an option in',
  'Typed into': 'Typing into',
  'Filled in a form': 'Filling in a form',
  Pressed: 'Pressing',
  'Took a screenshot': 'Taking a screenshot',
  'Read the page': 'Reading the page',
  'Looked on the page for': 'Looking on the page for',
  'Resized the window to': 'Resizing the window to',
  'Ran a script in the page': 'Running a script in the page',
  'Waited for': 'Waiting for',
  'Read the console': 'Reading the console',
  'Read the network requests': 'Reading the network requests',
  'Switched tabs': 'Switching tabs',
  'Closed the browser': 'Closing the browser',
  'Ran a subagent:': 'Running a subagent:',
  'Updated the to-do list': 'Updating the to-do list',
  'Proposed the plan': 'Proposing the plan',
  'Handed over the phase': 'Handing over the phase',
  'Handed over the fix': 'Handing over the fix',
  'Reported the review': 'Reporting the review',
  'Asked you:': 'Asking you:',
  'Attached evidence:': 'Attaching evidence:',
  'Looked up tasks:': 'Looking up tasks:',
  'Looked up tasks': 'Looking up tasks',
  'Read a task': 'Reading a task',
  'Listed the other work in the repository': 'Listing the other work in the repository',
  'Left a note:': 'Leaving a note:',
  'Scheduled a check-in:': 'Scheduling a check-in:',
  'Handed over the answer': 'Handing over the answer',
  'Reported the diagnosis': 'Reporting the diagnosis',
  'Wrote the report': 'Writing the report',
  'Reported the outcome': 'Reporting the outcome',
  'Changed the kind of task': 'Changing the kind of task',
  'Delegated:': 'Delegating:',
  'Checked a delegation': 'Checking a delegation',
  'Stopped a delegation': 'Stopping a delegation',
  'Answered a delegated agent:': 'Answering a delegated agent:',
  'Created a task:': 'Creating a task:',
  'Filed a report:': 'Filing a report:',
  'Split the plan into': 'Splitting the plan into',
  'Set a schedule:': 'Setting a schedule:',
  'Listed the schedules': 'Listing the schedules',
  'Deleted a schedule': 'Deleting a schedule',
  'Asked you for a secret:': 'Asking you for a secret:',
};

export function resolvePresentVerb(verb: string) {
  return PRESENT_VERB[verb] ?? verb;
}

export function resolveRunningLabel(description: ToolDescription) {
  const { verb, target, scope } = description;
  return [resolvePresentVerb(verb), target, scope && `· ${scope}`].filter(Boolean).join(' ');
}

const GROUP_PHRASES: Record<ToolGroupKey, (count: number) => string> = {
  read: (count) => `read ${formatCount(count, 'file', 'files')}`,
  edit: (count) => `edited ${formatCount(count, 'file', 'files')}`,
  write: (count) => `wrote ${formatCount(count, 'file', 'files')}`,
  command: (count) => `ran ${formatCount(count, 'command', 'commands')}`,
  search: (count) => (count === 1 ? 'searched once' : `searched ${count} times`),
  fetch: (count) => `looked up ${formatCount(count, 'page', 'pages')}`,
  browser: (count) => (count === 1 ? 'used the browser once' : `took ${count} steps in the browser`),
  task: (count) => `ran ${formatCount(count, 'subagent', 'subagents')}`,
  todo: () => 'updated the to-do list',
  mcp: (count) => `used ${formatCount(count, 'connected tool', 'connected tools')}`,
  surface: (count) => `used ${formatCount(count, 'Shinsa tool', 'Shinsa tools')}`,
  other: (count) => `used ${formatCount(count, 'tool', 'tools')}`,
  propose_plan: () => 'proposed the plan',
  complete_phase: () => 'handed over the phase',
  complete_fix: () => 'handed over the fix',
  report_review: () => 'reported the review',
  ask: () => 'asked you a question',
  attach_evidence: (count) => `attached ${formatCount(count, 'piece of evidence', 'pieces of evidence')}`,
  remove_evidence: (count) => (count === 1 ? 'removed evidence' : `removed evidence ${count} times`),
  find_tasks: (count) => (count === 1 ? 'looked up tasks once' : `looked up tasks ${count} times`),
  read_task: (count) => `read ${formatCount(count, 'task', 'tasks')}`,
  list_repository_work: (count) =>
    count === 1
      ? 'listed the other work in the repository'
      : `listed the other work in the repository ${count} times`,
  list_services: (count) =>
    count === 1 ? 'listed the task’s services' : `listed the task’s services ${count} times`,
  run_service: (count) => `ran ${formatCount(count, 'service', 'services')}`,
  note: (count) => `left ${formatCount(count, 'note', 'notes')}`,
  wait_for: () => 'scheduled a check-in',
  suggest_tasks: () => 'suggested tasks',
  remember: (count) => (count === 1 ? 'proposed a rule to remember' : `proposed ${count} rules to remember`),
  answer: () => 'handed over the answer',
  report_diagnosis: () => 'reported the diagnosis',
  submit_report: () => 'wrote the report',
  report_outcome: () => 'reported the outcome',
  report_watch: () => 'reported the watchdog check',
  report_intake: () => 'reported what the watch found',
  reshape_task: () => 'changed the kind of task',
  delegate_task: (count) => `started ${formatCount(count, 'delegation', 'delegations')}`,
  delegation_status: (count) => (count === 1 ? 'checked a delegation' : `checked delegations ${count} times`),
  delegation_cancel: (count) => `stopped ${formatCount(count, 'delegation', 'delegations')}`,
  delegation_answer: (count) =>
    count === 1 ? 'answered a delegated agent' : `answered delegated agents ${count} times`,
  create_task: (count) => `created ${formatCount(count, 'task', 'tasks')}`,
  file_report: (count) => `filed ${formatCount(count, 'report', 'reports')}`,
  split_task: () => 'split the plan',
  set_schedule: (count) => `set ${formatCount(count, 'schedule', 'schedules')}`,
  list_schedules: () => 'listed the schedules',
  delete_schedule: (count) => `deleted ${formatCount(count, 'schedule', 'schedules')}`,
  request_secret: () => 'asked you for a secret',
};

export function resolveGroupPhrase(keys: ToolGroupKey[]) {
  const counts = new Map<ToolGroupKey, number>();
  for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
  const phrases = [...counts].map(([key, count]) => GROUP_PHRASES[key](count));
  return capitalise(describeList(phrases));
}
