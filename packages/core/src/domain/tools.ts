import { DELEGATION_LIMITS } from './delegations.ts';
import type { Run, RunPurpose, RunRole } from './types.ts';

export const SHINSA_TOOL_NAMES = [
  'propose_plan',
  'complete_phase',
  'complete_fix',
  'report_review',
  'ask',
  'attach_evidence',
  'remove_evidence',
  'find_tasks',
  'read_task',
  'list_repository_work',
  'list_services',
  'run_service',
  'note',
  'wait_for',
  'suggest_tasks',
  'remember',
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

type StepRole = Exclude<RunRole, 'planner' | 'builder'>;

const ROLE_TOOLS: Record<StepRole, readonly ShinsaToolName[]> = {
  agent: [
    'propose_plan',
    'reshape_task',
    'complete_phase',
    'complete_fix',
    'report_outcome',
    'ask',
    'attach_evidence',
    'remove_evidence',
    'find_tasks',
    'note',
    'wait_for',
    'suggest_tasks',
    'remember',
    'list_services',
    'run_service',
  ],
  reviewer: [
    'report_review',
    'attach_evidence',
    'remove_evidence',
    'find_tasks',
    'note',
    'suggest_tasks',
    'list_services',
    'run_service',
  ],
  answerer: ['answer', 'ask', 'find_tasks', 'note', 'suggest_tasks', 'remember'],
  investigator: [
    'report_diagnosis',
    'ask',
    'attach_evidence',
    'remove_evidence',
    'find_tasks',
    'note',
    'wait_for',
    'suggest_tasks',
    'remember',
    'list_services',
    'run_service',
  ],
  researcher: ['submit_report', 'ask', 'find_tasks', 'note', 'suggest_tasks', 'remember'],
};

export const PURPOSE_HAND_OVERS: Record<RunPurpose, readonly ShinsaToolName[]> = {
  plan: ['propose_plan', 'reshape_task'],
  build: ['complete_phase'],
  fix: ['complete_fix'],
  operate: ['report_outcome'],
};

const DELEGATE_TOOLS: readonly ShinsaToolName[] = [
  'ask',
  'attach_evidence',
  'find_tasks',
  'read_task',
  'note',
];

const READ_TOOLS: readonly ShinsaToolName[] = ['read_task', 'list_repository_work'];

const DELEGATION_TOOLS: readonly ShinsaToolName[] = [
  'delegate_task',
  'delegation_status',
  'delegation_cancel',
  'delegation_answer',
];

const TASK_TOOLS: Record<StepRole, readonly ShinsaToolName[]> = {
  agent: ['create_task', 'split_task'],
  reviewer: ['create_task'],
  answerer: ['create_task'],
  investigator: ['create_task'],
  researcher: ['create_task'],
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
  'agent',
  'answerer',
  'investigator',
  'researcher',
]);

function isStepRole(role: RunRole): role is StepRole {
  return role in ROLE_TOOLS;
}

export function isShinsaToolName(name: string): name is ShinsaToolName {
  return (SHINSA_TOOL_NAMES as readonly string[]).includes(name);
}

export function isHandOverTool(name: ShinsaToolName) {
  return HAND_OVER_TOOLS.has(name);
}

export const TASK_SESSION_ROLES: readonly RunRole[] = ['agent', 'answerer', 'investigator', 'researcher'];

export function isTaskSessionRole(role: RunRole) {
  return TASK_SESSION_ROLES.includes(role);
}

export function listCallableToolNames(role: RunRole, depth = 0): ShinsaToolName[] {
  if (depth > 0 || !isStepRole(role)) {
    return [...DELEGATE_TOOLS, ...(depth < DELEGATION_LIMITS.depth ? DELEGATION_TOOLS : [])];
  }
  return [
    ...ROLE_TOOLS[role],
    ...READ_TOOLS,
    ...DELEGATION_TOOLS,
    ...TASK_TOOLS[role],
    ...(SCHEDULING_ROLES.has(role) ? SCHEDULE_TOOLS : []),
    ...(role === 'reviewer' ? REVIEWER_SCHEDULE_TOOLS : []),
  ];
}

const TASK_SESSION_TOOLS: readonly ShinsaToolName[] = SHINSA_TOOL_NAMES.filter((tool) =>
  TASK_SESSION_ROLES.some((role) => listCallableToolNames(role).includes(tool))
);

export function listToolNames(role: RunRole, depth = 0): ShinsaToolName[] {
  if (depth === 0 && isTaskSessionRole(role)) return [...TASK_SESSION_TOOLS];
  return listCallableToolNames(role, depth);
}

export function hasTool(run: Run, tool: ShinsaToolName) {
  return listCallableToolNames(run.role, run.delegation?.depth ?? 0).includes(tool);
}
