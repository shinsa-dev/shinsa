import type { SharePreset } from '../domain/settings.ts';

export type ShareGroup =
  | 'identity'
  | 'requests'
  | 'progress'
  | 'summary'
  | 'people'
  | 'plan'
  | 'reports'
  | 'review'
  | 'evidence'
  | 'checks'
  | 'pull_request'
  | 'activity'
  | 'code'
  | 'runs'
  | 'live';

const STATUS_GROUPS: readonly ShareGroup[] = ['identity', 'requests', 'progress', 'summary'];

const FULL_GROUPS: readonly ShareGroup[] = [
  ...STATUS_GROUPS,
  'people',
  'plan',
  'reports',
  'review',
  'evidence',
  'checks',
  'pull_request',
  'activity',
  'code',
  'runs',
];

export const SHARE_PRESET_GROUPS: Readonly<Record<SharePreset, readonly ShareGroup[]>> = {
  status: STATUS_GROUPS,
  full: FULL_GROUPS,
  everything: [...FULL_GROUPS, 'live'],
};

export function hasShareGroup(preset: SharePreset, group: ShareGroup) {
  return SHARE_PRESET_GROUPS[preset].includes(group);
}
