import {
  type Briefing,
  type CompactionMode,
  DEFAULT_WORKSPACE_MODE,
  DELEGATE_ROLES,
  type PlanApproval,
  type RunPurpose,
  type RunRole,
  type StoredBriefing,
  type WorkspaceMode,
} from '@shinsa/core';

export interface StoredEventRow {
  seq: number;
  type: string;
  payload: string;
}

export interface LegacyBriefingRow {
  seq: number;
  at: number;
  payload: string;
}

export interface ProjectBriefing {
  projectId: string | null;
  stored: StoredBriefing;
}

type Payload = Record<string, unknown>;

const ROLE_PURPOSE = new Map<unknown, RunPurpose>([
  ['planner', 'plan'],
  ['builder', 'build'],
  ['fixer', 'fix'],
  ['shipper', 'fix'],
  ['operator', 'operate'],
]);

const STAGE_PURPOSE = new Map<unknown, RunPurpose>([
  ['planning', 'plan'],
  ['building', 'build'],
  ['fixing', 'fix'],
  ['operating', 'operate'],
]);

const RUN_PURPOSES: readonly unknown[] = [...STAGE_PURPOSE.values(), 'watch', 'intake'];

const INQUIRY_ROLES: readonly unknown[] = ['reviewer', 'answerer', 'investigator', 'researcher'];

const LEGACY_EVENT_TYPES = [
  'task.answered',
  'task.created',
  'task.staged',
  'settings.changed',
  'worktree.created',
  'run.started',
];

const WALKTHROUGH_EVENT_TYPES = ['phase.completed', 'work.submitted', 'walkthrough.revised'];

const TESTING_LOG_VERSION = 3;

const WEEKLY_READINGS_LOG_VERSION = 4;

const WATCH_CI_LOG_VERSION = 5;

const NO_GITBUTLER_LOG_VERSION = 6;

const FINDING_LEVELS_LOG_VERSION = 7;

const SCHEDULE_SOURCE_LOG_VERSION = 8;

const WATCHDOG_READS_LOG_VERSION = 9;

const CONTEXT_MANAGEMENT_LOG_VERSION = 11;

const AGENT_REPLY_LOG_VERSION = 12;

const TEAM_FOCUS_LOG_VERSION = 13;

const COMPACTION_BY_EUNOE_MODE = new Map<unknown, CompactionMode>([
  ['eunoe_compact', 'fold'],
  ['eunoe_default', 'fold'],
  ['claude', 'provider'],
]);

const PLAN_APPROVAL_BY_SWITCH = new Map<unknown, PlanApproval>([
  [true, 'large'],
  [false, 'when_asked'],
]);

const WATCHDOG_READS_EVENT_TYPES = ['task.created', 'watchdog.armed', 'watchdog.checked'];

const GITBUTLER_EVENT_TYPES = [
  'repo.registered',
  'repo.updated',
  'worktree.requested',
  'worktree.created',
  'gate.opened',
];

export function listLegacyEventTypes(version: number) {
  return [
    ...(version < 1 ? LEGACY_EVENT_TYPES : []),
    ...(version < TESTING_LOG_VERSION ? WALKTHROUGH_EVENT_TYPES : []),
    ...(version < WEEKLY_READINGS_LOG_VERSION ? ['run.metered'] : []),
    ...(version < WATCH_CI_LOG_VERSION ? ['pull_request.watched'] : []),
    ...(version < NO_GITBUTLER_LOG_VERSION ? GITBUTLER_EVENT_TYPES : []),
    ...(version < FINDING_LEVELS_LOG_VERSION ? ['review.reported'] : []),
    ...(version < SCHEDULE_SOURCE_LOG_VERSION ? ['schedule.written'] : []),
    ...(version < WATCHDOG_READS_LOG_VERSION ? WATCHDOG_READS_EVENT_TYPES : []),
    ...(version < CONTEXT_MANAGEMENT_LOG_VERSION ? ['settings.changed'] : []),
    ...(version < AGENT_REPLY_LOG_VERSION ? ['plan.proposed'] : []),
    ...(version < TEAM_FOCUS_LOG_VERSION ? ['focus.changed'] : []),
  ];
}

function isRecord(value: unknown): value is Payload {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function withoutKeys(value: Payload, keys: readonly string[]) {
  return Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)));
}

function resolveAgentPurpose(run: Payload, stage: string | undefined): RunPurpose {
  if (RUN_PURPOSES.includes(run.purpose)) return run.purpose as RunPurpose;
  const fromStage = STAGE_PURPOSE.get(stage);
  if (fromStage) return fromStage;
  return typeof run.phaseIndex === 'number' ? 'build' : 'plan';
}

function resolveDelegatedRun(run: Payload): Payload {
  const role = (DELEGATE_ROLES as readonly unknown[]).includes(run.role) ? run.role : 'builder';
  return { ...withoutKeys(run, ['purpose']), role };
}

function resolveTopLevelRun(run: Payload, stage: string | undefined): Payload {
  if (INQUIRY_ROLES.includes(run.role)) return withoutKeys(run, ['purpose']);
  if (run.role === 'agent') return { ...run, purpose: resolveAgentPurpose(run, stage) };
  const purpose = ROLE_PURPOSE.get(run.role);
  if (!purpose) return run;
  return { ...run, role: 'agent' satisfies RunRole, purpose };
}

function resolveRun(run: Payload, stage: string | undefined) {
  if (isRecord(run.delegation)) return resolveDelegatedRun(run);
  return resolveTopLevelRun(run, stage);
}

function resolveWalkthrough(walkthrough: unknown) {
  if (!isRecord(walkthrough) || !Array.isArray(walkthrough.testing)) return walkthrough;
  return { ...walkthrough, testing: { automated: walkthrough.testing, manual: [] } };
}

function resolveReport(event: Payload) {
  if (!isRecord(event.report) || !isRecord(event.report.walkthrough)) return event;
  return { ...event, report: { ...event.report, walkthrough: resolveWalkthrough(event.report.walkthrough) } };
}

function resolveRepo(event: Payload) {
  if (!isRecord(event.repo) || event.repo.workspace !== 'gitbutler') return event;
  return { ...event, repo: { ...event.repo, workspace: DEFAULT_WORKSPACE_MODE } };
}

function resolveSchedule(event: Payload) {
  if (!isRecord(event.schedule) || ('source' in event.schedule && 'lastReadAt' in event.schedule))
    return event;
  return { ...event, schedule: { source: null, lastReadAt: null, ...event.schedule } };
}

function resolveForkTaskIds(value: Payload) {
  if (!('forkTaskId' in value)) return value;
  const forkTaskIds = typeof value.forkTaskId === 'string' ? [value.forkTaskId] : [];
  return { ...withoutKeys(value, ['forkTaskId']), forkTaskIds };
}

function resolveArmedWatchdog(watchdog: Payload) {
  const resolved = resolveForkTaskIds(watchdog);
  return 'linkedTaskIds' in resolved ? resolved : { ...resolved, linkedTaskIds: [] };
}

function resolveCreatedTask(event: Payload) {
  const created = 'specFirst' in event ? resolvePlanFirst(event) : event;
  if (!isRecord(created.sourceReport) || 'watchdogId' in created.sourceReport) return created;
  return { ...created, sourceReport: { ...created.sourceReport, watchdogId: null } };
}

function resolvePlanFirst(event: Payload): Payload {
  const { specFirst, ...rest } = event;
  return { ...rest, planFirst: event.planFirst ?? specFirst };
}

function resolveSettings(settings: Payload) {
  const current = withoutKeys(settings, ['worktreesDirectory']);
  const approvePlans = PLAN_APPROVAL_BY_SWITCH.get(current.approvePlans);
  const compaction = COMPACTION_BY_EUNOE_MODE.get(current.compaction);
  return {
    ...current,
    ...(approvePlans ? { approvePlans } : {}),
    ...(compaction ? { compaction } : {}),
  };
}

function resolveGate(event: Payload) {
  if (!isRecord(event.gate) || event.gate.cause !== 'workspace_update') return event;
  return { ...event, gate: withoutKeys(event.gate, ['cause']) };
}

function resolveFinding(finding: unknown) {
  if (!isRecord(finding) || finding.severity !== 'suggestion') return finding;
  return { ...finding, severity: 'optional' };
}

function resolveFindings(event: Payload) {
  if (!Array.isArray(event.findings)) return event;
  return { ...event, findings: event.findings.map(resolveFinding) };
}

function resolveEvent(event: Payload, stages: Map<string, string>): Payload {
  switch (event.type) {
    case 'task.answered': {
      const { answer, ...rest } = event;
      return { ...rest, type: 'task.delivered', step: 'answer', body: answer, runId: event.runId ?? null };
    }
    case 'task.created':
      return resolveCreatedTask(event);
    case 'task.staged':
      if (typeof event.taskId === 'string' && typeof event.stage === 'string') {
        stages.set(event.taskId, event.stage);
      }
      return event;
    case 'settings.changed':
      if (!isRecord(event.settings)) return event;
      return { ...event, settings: resolveSettings(event.settings) };
    case 'repo.registered':
    case 'repo.updated':
      return resolveRepo(event);
    case 'worktree.requested':
      if (event.workspace !== 'gitbutler') return event;
      return { ...event, workspace: DEFAULT_WORKSPACE_MODE };
    case 'worktree.created':
      if (event.workspace === 'gitbutler')
        return { ...event, workspace: 'main_checkout' satisfies WorkspaceMode };
      if ('workspace' in event) return event;
      return { ...event, workspace: DEFAULT_WORKSPACE_MODE };
    case 'gate.opened':
      return resolveGate(event);
    case 'run.started': {
      if (!isRecord(event.run)) return event;
      const taskId = typeof event.run.taskId === 'string' ? event.run.taskId : '';
      return { ...event, run: resolveRun(event.run, stages.get(taskId)) };
    }
    case 'phase.completed':
    case 'work.submitted':
      return resolveReport(event);
    case 'walkthrough.revised':
      return { ...event, walkthrough: resolveWalkthrough(event.walkthrough) };
    case 'run.metered':
      return withoutKeys(event, ['weeklyPercent']);
    case 'schedule.written':
      return resolveSchedule(event);
    case 'pull_request.watched':
      if (!isRecord(event.watch) || 'ciAbsent' in event.watch) return event;
      return { ...event, watch: { ...event.watch, ciAbsent: false } };
    case 'review.reported':
      return resolveFindings(event);
    case 'watchdog.armed':
      if (!isRecord(event.watchdog)) return event;
      return { ...event, watchdog: resolveArmedWatchdog(event.watchdog) };
    case 'watchdog.checked':
      return resolveForkTaskIds(event);
    case 'plan.proposed':
      return withoutKeys(event, ['changeSummary', 'feedback']);
    case 'focus.changed':
      if (!isRecord(event.focus) || 'teamId' in event.focus) return event;
      return { ...event, focus: { ...event.focus, teamId: null } };
    default:
      return event;
  }
}

function parsePayload(payload: string): Payload | null {
  try {
    const value: unknown = JSON.parse(payload);
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

export function listLegacyRewrites(rows: Iterable<StoredEventRow>): StoredEventRow[] {
  const stages = new Map<string, string>();
  const rewrites: StoredEventRow[] = [];
  for (const row of rows) {
    const event = parsePayload(row.payload);
    if (!event || event.type !== row.type) continue;
    const current = resolveEvent(event, stages);
    const payload = JSON.stringify(current);
    if (payload === row.payload) continue;
    rewrites.push({ seq: row.seq, type: String(current.type), payload });
  }
  return rewrites;
}

function resolveLegacyBriefing(row: LegacyBriefingRow): ProjectBriefing | null {
  const event = parsePayload(row.payload);
  if (!event || typeof event.text !== 'string') return null;
  const projectId = typeof event.projectId === 'string' ? event.projectId : null;
  const briefing = isRecord(event.briefing) ? (event.briefing as unknown as Briefing) : null;
  return { projectId, stored: { text: event.text, at: row.at, briefing } };
}

export function listLegacyBriefings(rows: Iterable<LegacyBriefingRow>): ProjectBriefing[] {
  const newest = new Map<string | null, ProjectBriefing>();
  for (const row of rows) {
    const briefing = resolveLegacyBriefing(row);
    if (briefing) newest.set(briefing.projectId, briefing);
  }
  return [...newest.values()];
}
