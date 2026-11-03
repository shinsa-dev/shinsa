import {
  type RemoteTeam,
  TEAM_PERMISSION_NAMES,
  type TeamPermission,
  type TeamPermissions,
  type TeamPermissionsChange,
} from '@shinsa/core';

export const PERMISSIONS_TITLE = 'What teammates can do';

export const PERMISSION_ROWS: readonly { name: TeamPermission; title: string; hint: string }[] = [
  {
    name: 'act',
    title: 'Act on tasks',
    hint: 'Answer gates, approve, retry and cancel the team’s tasks on your machines.',
  },
  { name: 'takeOver', title: 'Take over tasks', hint: 'Make one of the team’s tasks theirs to steer.' },
  {
    name: 'share',
    title: 'Share tasks',
    hint: 'Make share links for the team’s tasks, status shares included.',
  },
  {
    name: 'services',
    title: 'Open services',
    hint: 'Open the running services of the team’s tasks at their private address.',
  },
  {
    name: 'message',
    title: 'Message agents',
    hint: 'Message the agents of tasks they did not take over. Whoever takes a task over can always message it.',
  },
];

export type OverrideChoice = 'team' | 'on' | 'off';

const CHOICE_VALUES: Record<OverrideChoice, boolean | null> = { team: null, on: true, off: false };

export function describePermissionsSummary(permissions: TeamPermissions) {
  const on = TEAM_PERMISSION_NAMES.filter((name) => permissions[name]).length;
  return `${on} of ${TEAM_PERMISSION_NAMES.length} on`;
}

export function describePermissionsOwner(team: RemoteTeam) {
  return team.role === 'owner' ? null : `Only ${team.owner.name ?? team.owner.login} changes these.`;
}

export function listOverrideItems(teamValue: boolean) {
  return [
    { value: 'team' as const, label: `Team setting (${teamValue ? 'On' : 'Off'})` },
    { value: 'on' as const, label: 'On' },
    { value: 'off' as const, label: 'Off' },
  ];
}

export function selectOverride(team: RemoteTeam, userId: string) {
  return team.overrides.find((entry) => entry.userId === userId)?.permissions ?? null;
}

export function resolveOverrideChoice(
  team: RemoteTeam,
  userId: string,
  name: TeamPermission
): OverrideChoice {
  const value = selectOverride(team, userId)?.[name];
  if (value === undefined) return 'team';
  return value ? 'on' : 'off';
}

export function createOverrideChange(name: TeamPermission, choice: OverrideChoice): TeamPermissionsChange {
  return { [name]: CHOICE_VALUES[choice] };
}

export function hasOwnRights(team: RemoteTeam, userId: string) {
  const override = selectOverride(team, userId);
  return override !== null && Object.keys(override).length > 0;
}
