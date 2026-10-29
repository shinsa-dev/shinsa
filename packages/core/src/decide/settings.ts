import { AGENT_ROLES, resolveAgentProvider } from '../agent-models/index.ts';
import type { CommandOf } from '../commands/index.ts';
import {
  DomainError,
  HUMAN_ONLY_REPO_FIELDS,
  HUMAN_ONLY_SETTINGS,
  isProjectKey,
  MAX_COMPACTION_LEAD_MINUTES,
  PROJECT_COLORS,
  PROJECT_LIMITS,
  type Project,
  resolveProjectKey,
  type Settings,
  selectFolderProject,
  WATCHDOG_SETTING_LIMITS,
} from '../domain/index.ts';
import { releaseBudgetHolds } from './costs.ts';
import type { Decider } from './decider.ts';
import { isSameValue } from './equality.ts';
import { removeProjectMemory } from './memory.ts';

function assertProject(decider: Decider, projectId: string | null | undefined) {
  if (projectId && !decider.state.projects[projectId]) {
    throw new DomainError('project_not_found', `No project ${projectId}`);
  }
}

function isWholeBetween(value: number, min: number, max: number) {
  return Number.isInteger(value) && value >= min && value <= max;
}

function assertSettings(patch: Partial<Settings>) {
  const rounds = patch.maxFixRounds;
  if (rounds !== undefined && rounds !== null && !isWholeBetween(rounds, 1, Number.MAX_SAFE_INTEGER)) {
    throw new DomainError('settings_invalid', 'Fix rounds must be a whole number of 1 or more.');
  }
  const delegations = patch.delegationLimit;
  if (
    delegations !== undefined &&
    delegations !== null &&
    !isWholeBetween(delegations, 1, Number.MAX_SAFE_INTEGER)
  ) {
    throw new DomainError(
      'settings_invalid',
      'Delegations at once must be a whole number of 1 or more, or no limit.'
    );
  }
  const attention = patch.attentionLimit;
  if (attention !== undefined && !isWholeBetween(attention, 1, Number.MAX_SAFE_INTEGER)) {
    throw new DomainError('settings_invalid', 'The attention limit must be a whole number of 1 or more.');
  }
  const switchAt = patch.accountSwitchAt;
  if (switchAt !== undefined && !isWholeBetween(switchAt, 1, 100)) {
    throw new DomainError('settings_invalid', 'Switch accounts at a whole percentage from 1 to 100.');
  }
  const lead = patch.compactionLeadMinutes;
  if (lead !== undefined && !isWholeBetween(lead, 1, MAX_COMPACTION_LEAD_MINUTES)) {
    throw new DomainError(
      'settings_invalid',
      `Compact from 1 to ${MAX_COMPACTION_LEAD_MINUTES} minutes before the cache expires.`
    );
  }
  assertWatchdogSettings(patch);
  const budget = patch.taskBudgetUsd;
  if (budget !== undefined && budget !== null && !(Number.isFinite(budget) && budget > 0)) {
    throw new DomainError('settings_invalid', 'The cost limit must be an amount above zero, or off.');
  }
  const usage = patch.taskUsageLimit;
  if (usage !== undefined && usage !== null && !isWholeBetween(usage, 1, 100)) {
    throw new DomainError(
      'settings_invalid',
      'The usage limit must be a whole percentage from 1 to 100, or off.'
    );
  }
}

const WATCHDOG_SETTING_RULES = [
  ['watchdogHours', WATCHDOG_SETTING_LIMITS.hours, 'Watchdogs watch for 1 to {max} hours.'],
  [
    'watchdogFirstCheckMinutes',
    WATCHDOG_SETTING_LIMITS.firstCheckMinutes,
    'The first check comes 1 to {max} minutes in.',
  ],
  ['watchdogMaxGapHours', WATCHDOG_SETTING_LIMITS.maxGapHours, 'Checks are at most 1 to {max} hours apart.'],
] as const;

function assertWatchdogSettings(patch: Partial<Settings>) {
  for (const [key, max, message] of WATCHDOG_SETTING_RULES) {
    const value = patch[key];
    if (value !== undefined && !isWholeBetween(value, 1, max)) {
      throw new DomainError('settings_invalid', message.replace('{max}', String(max)));
    }
  }
}

function listKeys(decider: Decider, except: string | null) {
  return Object.values(decider.state.projects)
    .filter((project) => project.id !== except)
    .map((project) => project.key);
}

function upsertProject(decider: Decider, name: string) {
  const existing = Object.values(decider.state.projects).find(
    (project) => project.name.toLowerCase() === name.toLowerCase()
  );
  if (existing) return existing.id;
  const id = decider.context.newId();
  const color = PROJECT_COLORS[Object.keys(decider.state.projects).length % PROJECT_COLORS.length] ?? 'blue';
  decider.emit({
    type: 'project.written',
    project: {
      id,
      name,
      color,
      key: resolveProjectKey(name, listKeys(decider, null)),
      description: '',
      folders: [],
    },
  });
  return id;
}

function resolveRegisteredProject(decider: Decider, command: CommandOf<'repo.register'>) {
  if (command.projectId && decider.state.projects[command.projectId]) return command.projectId;
  const byFolder = selectFolderProject(Object.values(decider.state.projects), command.repo.path);
  if (byFolder) return byFolder.id;
  const name = command.projectName?.trim();
  return name ? upsertProject(decider, name) : null;
}

export function registerRepo(decider: Decider, command: CommandOf<'repo.register'>) {
  if (Object.values(decider.state.repos).some((repo) => repo.path === command.repo.path)) return;
  const projectId = resolveRegisteredProject(decider, command);
  decider.emit({
    type: 'repo.registered',
    repo: { ...command.repo, projectId, id: decider.context.newId() },
  });
}

function assertHumanOnlyFields(decider: Decider, patch: object, fields: readonly string[], what: string) {
  if (!decider.context.onBehalf) return;
  const touched = fields.filter((field) => field in patch);
  if (touched.length === 0) return;
  throw new DomainError(
    'human_only',
    `Only the human changes ${what} ${touched.join(', ')}. Tell them what you would change and why.`
  );
}

export function updateRepo(decider: Decider, command: CommandOf<'repo.update'>) {
  const repo = decider.state.repos[command.repoId];
  if (!repo) throw new DomainError('repo_not_found', `No repository ${command.repoId}`);
  assertHumanOnlyFields(decider, command.patch, HUMAN_ONLY_REPO_FIELDS, 'the repository’s');
  assertProject(decider, command.patch.projectId);
  const updated = { ...repo, ...command.patch };
  if (isSameValue(updated, repo)) return;
  decider.emit({ type: 'repo.updated', repo: updated });
}

export function removeRepo(decider: Decider, command: CommandOf<'repo.remove'>) {
  if (!decider.state.repos[command.repoId]) return;
  decider.emit({ type: 'repo.removed', repoId: command.repoId });
}

function readFolders(folders: readonly string[]) {
  const cleaned = [...new Set(folders.map((folder) => folder.trim().replace(/\/+$/, '')))].filter(Boolean);
  if (cleaned.length > PROJECT_LIMITS.folders) {
    throw new DomainError('project_invalid', `A project can have at most ${PROJECT_LIMITS.folders} folders.`);
  }
  for (const folder of cleaned) {
    if (!folder.startsWith('/') || folder.length > PROJECT_LIMITS.folder) {
      throw new DomainError('project_invalid', `“${folder}” is not a full folder path.`);
    }
  }
  return cleaned;
}

function resolveKey(decider: Decider, command: CommandOf<'project.write'>, existing: Project | undefined) {
  const others = listKeys(decider, existing?.id ?? null);
  const asked = command.project.key?.trim().toUpperCase();
  if (asked === undefined || asked === '') {
    return existing?.key ?? resolveProjectKey(command.project.name, others);
  }
  if (!isProjectKey(asked)) {
    throw new DomainError(
      'project_invalid',
      'A project key is 2 to 6 letters or digits and starts with a letter, like SW.'
    );
  }
  if (others.includes(asked)) {
    throw new DomainError('project_key_taken', `Another project already uses the key ${asked}.`);
  }
  return asked;
}

function assertFoldersFree(decider: Decider, projectId: string, folders: string[]) {
  for (const project of Object.values(decider.state.projects)) {
    if (project.id === projectId) continue;
    const shared = folders.find((folder) => project.folders.includes(folder));
    if (shared) {
      throw new DomainError('folder_taken', `“${shared}” already belongs to the project ${project.name}.`);
    }
  }
}

function moveReposIntoFolders(decider: Decider, project: Project) {
  const projects = Object.values(decider.state.projects);
  for (const repo of Object.values(decider.state.repos)) {
    if (repo.projectId === project.id) continue;
    if (selectFolderProject(projects, repo.path)?.id !== project.id) continue;
    decider.emit({ type: 'repo.updated', repo: { ...repo, projectId: project.id } });
  }
}

export function writeProject(decider: Decider, command: CommandOf<'project.write'>) {
  const name = command.project.name.trim();
  if (name.length === 0) throw new DomainError('project_name_required', 'Name the project.');
  if (name.length > PROJECT_LIMITS.name) {
    throw new DomainError('project_invalid', `A project name is at most ${PROJECT_LIMITS.name} characters.`);
  }
  const existing = command.project.id ? decider.state.projects[command.project.id] : undefined;
  const description = (command.project.description ?? existing?.description ?? '').trim();
  if (description.length > PROJECT_LIMITS.description) {
    throw new DomainError(
      'project_invalid',
      `A project description is at most ${PROJECT_LIMITS.description} characters.`
    );
  }
  const id = existing?.id ?? decider.context.newId();
  const folders = readFolders(command.project.folders ?? existing?.folders ?? []);
  assertFoldersFree(decider, id, folders);
  const project: Project = {
    id,
    name,
    color: command.project.color,
    key: resolveKey(decider, command, existing),
    description,
    folders,
    ...(existing?.watchSources ? { watchSources: existing.watchSources } : {}),
  };
  if (existing && isSameValue(project, existing)) return;
  decider.emit({ type: 'project.written', project });
  moveReposIntoFolders(decider, project);
}

export function removeProject(decider: Decider, command: CommandOf<'project.remove'>) {
  if (!decider.state.projects[command.projectId]) return;
  for (const repo of Object.values(decider.state.repos)) {
    if (repo.projectId === command.projectId) {
      decider.emit({ type: 'repo.updated', repo: { ...repo, projectId: null } });
    }
  }
  if (decider.state.focus.projectId === command.projectId) {
    decider.emit({ type: 'focus.changed', focus: { projectId: null, until: null } });
    decider.run({ kind: 'briefing.request', projectId: null });
  }
  removeProjectMemory(decider, command.projectId);
  decider.emit({ type: 'project.removed', projectId: command.projectId });
}

export function changeFocus(decider: Decider, command: CommandOf<'focus.change'>) {
  assertProject(decider, command.projectId);
  const focus = { projectId: command.projectId, until: command.until };
  if (isSameValue(focus, decider.state.focus)) return;
  decider.emit({ type: 'focus.changed', focus });
  decider.run({ kind: 'briefing.request', projectId: command.projectId });
}

function dropStaleModels(previous: Settings, patch: Partial<Settings>): Settings {
  const settings = { ...previous, ...patch };
  const models = { ...settings.agentModels };
  for (const role of AGENT_ROLES) {
    const moved = resolveAgentProvider(settings, role) !== resolveAgentProvider(previous, role);
    if (moved && patch.agentModels?.[role] === undefined) delete models[role];
  }
  const providerMoved = settings.defaultProvider !== previous.defaultProvider;
  return {
    ...settings,
    agentModels: models,
    defaultModel: providerMoved && !('defaultModel' in patch) ? null : settings.defaultModel,
  };
}

export function changeSettings(decider: Decider, command: CommandOf<'settings.change'>) {
  assertHumanOnlyFields(decider, command.patch, HUMAN_ONLY_SETTINGS, 'the settings');
  assertSettings(command.patch);
  const settings = dropStaleModels(decider.state.settings, command.patch);
  if (isSameValue(settings, decider.state.settings)) return;
  decider.emit({ type: 'settings.changed', settings });
  releaseBudgetHolds(decider);
}
