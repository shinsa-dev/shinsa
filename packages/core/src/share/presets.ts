import type { SharePreset } from '../domain/settings.ts';
import { ACCESS_PRESETS, listViewScopes } from '../scopes/index.ts';
import type { ViewScope } from '../scopes/schema.ts';

export type ShareGroup = ViewScope;

export const SHARE_PRESET_GROUPS: Readonly<Record<SharePreset, readonly ShareGroup[]>> = {
  status: listViewScopes(ACCESS_PRESETS.status),
  standard: listViewScopes(ACCESS_PRESETS.standard),
  full: listViewScopes(ACCESS_PRESETS.full),
};

export function hasShareGroup(preset: SharePreset, group: ShareGroup) {
  return SHARE_PRESET_GROUPS[preset].includes(group);
}
