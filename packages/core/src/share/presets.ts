import type { SharePreset } from '../domain/settings.ts';

export type ShareGroup =
  | 'identity'
  | 'description'
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
  | 'live'
  | 'messages';

const STATUS_GROUPS: readonly ShareGroup[] = ['identity', 'description', 'progress'];

const STANDARD_GROUPS: readonly ShareGroup[] = [
  ...STATUS_GROUPS,
  'summary',
  'requests',
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
  'live',
];

const FULL_GROUPS: readonly ShareGroup[] = [...STANDARD_GROUPS, 'messages'];

export const SHARE_PRESET_GROUPS: Readonly<Record<SharePreset, readonly ShareGroup[]>> = {
  status: STATUS_GROUPS,
  standard: STANDARD_GROUPS,
  full: FULL_GROUPS,
};

export function hasShareGroup(preset: SharePreset, group: ShareGroup) {
  return SHARE_PRESET_GROUPS[preset].includes(group);
}
