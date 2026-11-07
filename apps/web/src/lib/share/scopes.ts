import { SHARE_PRESET_SCOPES, SHARE_PRESETS, type SharePreset, type ViewScope } from '@shinsa/core';

export interface ShareScopesSource {
  scopes?: readonly ViewScope[];
  preset?: SharePreset;
}

export function resolveShareSourceScopes(source: ShareScopesSource): readonly ViewScope[] {
  if (Array.isArray(source.scopes)) return source.scopes;
  const preset = source.preset && SHARE_PRESETS.includes(source.preset) ? source.preset : 'standard';
  return SHARE_PRESET_SCOPES[preset];
}
