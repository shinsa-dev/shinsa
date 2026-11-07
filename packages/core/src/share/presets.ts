import { SHARE_PRESETS, type SharePreset } from '../domain/settings.ts';
import { ACCESS_PRESETS, listViewScopes, resolvePreset } from '../scopes/index.ts';
import { VIEW_SCOPES, type ResolvedPreset, type ViewScope } from '../scopes/schema.ts';

export type ShareGroup = ViewScope;

export const SHARE_REQUIRED_SCOPE: ViewScope = 'identity';

export const SHARE_PRESET_SCOPES: Readonly<Record<SharePreset, readonly ViewScope[]>> = {
  status: listViewScopes(ACCESS_PRESETS.status),
  standard: listViewScopes(ACCESS_PRESETS.standard),
  full: listViewScopes(ACCESS_PRESETS.full),
};

export function hasShareGroup(scopes: readonly ViewScope[], group: ShareGroup) {
  return scopes.includes(group);
}

export function resolveShareScopes(scopes: readonly ViewScope[]): readonly ViewScope[] {
  return VIEW_SCOPES.filter((scope) => scope === SHARE_REQUIRED_SCOPE || scopes.includes(scope));
}

export function resolveShareScopesPreset(scopes: readonly ViewScope[]): ResolvedPreset<SharePreset> {
  return resolvePreset(resolveShareScopes(scopes), SHARE_PRESETS, listViewScopes);
}

export function hasSameShareScopes(left: readonly ViewScope[], right: readonly ViewScope[]) {
  const shown = resolveShareScopes(left);
  const other = resolveShareScopes(right);
  return shown.length === other.length && shown.every((scope) => other.includes(scope));
}
