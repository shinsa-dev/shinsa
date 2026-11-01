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
  | 'live';

const STATUS_GROUPS: readonly ShareGroup[] = ['identity', 'description', 'progress', 'summary'];

const DEFAULT_GROUPS: readonly ShareGroup[] = [
  ...STATUS_GROUPS,
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

export const SHARE_PRESET_GROUPS: Readonly<Record<SharePreset, readonly ShareGroup[]>> = {
  default: DEFAULT_GROUPS,
  status: STATUS_GROUPS,
};

export function hasShareGroup(preset: SharePreset, group: ShareGroup) {
  return SHARE_PRESET_GROUPS[preset].includes(group);
}
