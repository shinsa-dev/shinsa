import { DELEGATION_LIMITS } from './delegations.ts';
import type { Run, RunRole } from './types.ts';

export const SHINSA_TOOL_NAMES = [
  'propose_plan',
  'complete_phase',
  'complete_fix',
  'report_review',
  'ask',
  'attach_evidence',
  'find_tasks',
  'read_task',
  'note',
  'wait_for',
  'suggest_tasks',
  'answer',
  'report_diagnosis',
  'submit_report',
  'report_outcome',
  'reshape_task',
  'delegate_task',
  'delegation_status',
  'delegation_cancel',
  'delegation_answer',
  'create_task',
  'split_task',
  'set_schedule',
  'list_schedules',
  'delete_schedule',
  'request_secret',
] as const;

export type ShinsaToolName = (typeof SHINSA_TOOL_NAMES)[number];

const HAND_OVER_TOOLS: ReadonlySet<ShinsaToolName> = new Set<ShinsaToolName>([
  'propose_plan',
  'complete_phase',
  'complete_fix',
  'report_review',
  'answer',
  'report_diagnosis',
  'submit_report',
  'report_outcome',
  'reshape_task',
]);

const ROLE_TOOLS: Record<RunRole, readonly ShinsaToolName[]> = {
  planner: ['propose_plan', 'reshape_task', 'ask', 'find_tasks', 'note', 'suggest_tasks'],
  builder: ['complete_phase', 'ask', 'attach_evidence', 'find_tasks', 'note', 'wait_for', 'suggest_tasks'],
  reviewer: ['report_review', 'attach_evidence', 'find_tasks', 'note', 'suggest_tasks'],
  fixer: ['complete_fix', 'ask', 'attach_evidence', 'find_tasks', 'note', 'wait_for', 'suggest_tasks'],
  answerer: ['answer', 'ask', 'find_tasks', 'note', 'suggest_tasks'],
  investigator: [
    'report_diagnosis',
    'ask',
    'attach_evidence',
    'find_tasks',
    'note',
    'wait_for',
    'suggest_tasks',
  ],
  researcher: ['submit_report', 'ask', 'find_tasks', 'note', 'suggest_tasks'],
  operator: ['report_outcome', 'ask', 'attach_evidence', 'find_tasks', 'note', 'wait_for', 'suggest_tasks'],
};

const DELEGATE_TOOLS: readonly ShinsaToolName[] = [
  'ask',
  'attach_evidence',
  'find_tasks',
  'read_task',
  'note',
];

const READ_TOOLS: readonly ShinsaToolName[] = ['read_task'];

const DELEGATION_TOOLS: readonly ShinsaToolName[] = [
  'delegate_task',
  'delegation_status',
  'delegation_cancel',
  'delegation_answer',
];

const TASK_TOOLS: Partial<Record<RunRole, readonly ShinsaToolName[]>> = {
  planner: ['create_task'],
  reviewer: ['create_task'],
  builder: ['create_task', 'split_task'],
  fixer: ['create_task'],
  answerer: ['create_task'],
  investigator: ['create_task'],
  researcher: ['create_task'],
  operator: ['create_task'],
};

const SCHEDULE_TOOLS: readonly ShinsaToolName[] = [
  'set_schedule',
  'list_schedules',
  'delete_schedule',
  'request_secret',
];

const REVIEWER_SCHEDULE_TOOLS: readonly ShinsaToolName[] = [
  'set_schedule',
  'list_schedules',
  'delete_schedule',
];

const SCHEDULING_ROLES: ReadonlySet<RunRole> = new Set<RunRole>([
  'planner',
  'builder',
  'fixer',
  'answerer',
  'investigator',
  'researcher',
  'operator',
]);

export function isShinsaToolName(name: string): name is ShinsaToolName {
  return (SHINSA_TOOL_NAMES as readonly string[]).includes(name);
}

export function isHandOverTool(name: ShinsaToolName) {
  return HAND_OVER_TOOLS.has(name);
}

export function listToolNames(role: RunRole, depth = 0): ShinsaToolName[] {
  if (depth > 0) return [...DELEGATE_TOOLS, ...(depth < DELEGATION_LIMITS.depth ? DELEGATION_TOOLS : [])];
  return [
    ...ROLE_TOOLS[role],
    ...READ_TOOLS,
    ...DELEGATION_TOOLS,
    ...(TASK_TOOLS[role] ?? []),
    ...(SCHEDULING_ROLES.has(role) ? SCHEDULE_TOOLS : []),
    ...(role === 'reviewer' ? REVIEWER_SCHEDULE_TOOLS : []),
  ];
}

export function hasTool(run: Run, tool: ShinsaToolName) {
  return listToolNames(run.role, run.delegation?.depth ?? 0).includes(tool);
}
