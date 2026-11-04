import {
  ACCESS_PRESETS,
  ACCESS_SCOPES,
  ACTION_SCOPES,
  type AccessScopes,
  type ActionScope,
  CUSTOM_PRESET,
  listActionScopes,
  type RemoteTeam,
  type ResolvedPreset,
  resolvePreset,
  TEAM_PRESET_NAMES,
  type TeamPreset,
} from '@shinsa/core';

export const SCOPES_TITLE = 'What teammates can do';

export const TEAM_CHOICE = 'team';

export type TeamScopeChoice = ResolvedPreset<TeamPreset>;

export type MemberScopeChoice = TeamScopeChoice | typeof TEAM_CHOICE;

export const PRESET_LABELS: Record<TeamScopeChoice, { label: string; hint: string }> = {
  standard: { label: 'View only', hint: 'See the team’s tasks. Change nothing.' },
  collaborate: { label: 'Collaborate', hint: 'Everything but messaging agents.' },
  full: { label: 'Full access', hint: 'Everything, messaging agents included.' },
  custom: { label: 'Custom', hint: 'The scopes ticked below.' },
};

export const SCOPE_ROWS: Readonly<Record<ActionScope, { title: string; hint: string }>> = {
  gates: { title: 'Answer gates', hint: 'Approve plans, reviews and merges.' },
  actions: { title: 'Act on tasks', hint: 'Retry, snooze, prioritize and cancel.' },
  message: { title: 'Message agents', hint: 'Send messages to a task’s agent.' },
  fork: { title: 'Fork tasks', hint: 'Fork a task onto their own machine.' },
  share: { title: 'Share tasks', hint: 'Make share links, status shares included.' },
  services: { title: 'Open services', hint: 'Open a task’s running services.' },
};

export function resolveTeamChoice(scopes: AccessScopes): TeamScopeChoice {
  return resolvePreset(scopes, TEAM_PRESET_NAMES, listActionScopes);
}

interface ChoiceItem<Value extends string> {
  value: Value;
  label: string;
  hint: string;
}

export function listPresetItems(current: TeamScopeChoice): ChoiceItem<TeamScopeChoice>[] {
  const choices: TeamScopeChoice[] =
    current === CUSTOM_PRESET ? [...TEAM_PRESET_NAMES, CUSTOM_PRESET] : [...TEAM_PRESET_NAMES];
  return choices.map((value) => ({ value, ...PRESET_LABELS[value] }));
}

export function listMemberItems(
  team: RemoteTeam,
  current: MemberScopeChoice
): ChoiceItem<MemberScopeChoice>[] {
  const teamLabel = `Team’s (${PRESET_LABELS[resolveTeamChoice(team.scopes)].label})`;
  const presets = listPresetItems(current === TEAM_CHOICE ? 'standard' : current);
  return [{ value: TEAM_CHOICE, label: teamLabel, hint: 'Follows the team.' }, ...presets];
}

export function describeScopesSummary(scopes: AccessScopes) {
  const on = listActionScopes(scopes).length;
  return `${PRESET_LABELS[resolveTeamChoice(scopes)].label} · ${on} of ${ACTION_SCOPES.length} scopes`;
}

export function describeScopesOwner(team: RemoteTeam) {
  return team.role === 'owner' ? null : `Only ${team.owner.name ?? team.owner.login} changes these.`;
}

export function selectOverride(team: RemoteTeam, userId: string) {
  return team.overrides.find((entry) => entry.userId === userId)?.scopes ?? null;
}

export function resolveMemberChoice(team: RemoteTeam, userId: string): MemberScopeChoice {
  const own = selectOverride(team, userId);
  return own ? resolveTeamChoice(own) : TEAM_CHOICE;
}

export function resolveMemberScopes(team: RemoteTeam, userId: string) {
  return selectOverride(team, userId) ?? team.scopes;
}

export function resolveChoiceScopes(choice: MemberScopeChoice, current: AccessScopes): AccessScopes | null {
  if (choice === TEAM_CHOICE) return null;
  if (choice === CUSTOM_PRESET) return current;
  return ACCESS_PRESETS[choice];
}

export function hasOwnScopes(team: RemoteTeam, userId: string) {
  return selectOverride(team, userId) !== null;
}

export function resolveTeammateScopes(
  teams: readonly RemoteTeam[],
  instanceId: string,
  userId: string
): AccessScopes {
  const granted = teams
    .filter((team) => team.machines.some((machine) => machine.id === instanceId))
    .flatMap((team) => resolveMemberScopes(team, userId));
  return ACCESS_SCOPES.filter((scope) => granted.includes(scope));
}
