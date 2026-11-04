import { describe, expect, test } from 'bun:test';
import {
  ACCESS_PRESETS,
  ACCESS_SCOPES,
  CUSTOM_PRESET,
  hasScope,
  isActionScope,
  isViewScope,
  listActionScopes,
  listViewScopes,
  resolvePreset,
  SHARE_PRESET_GROUPS,
  TEAM_PRESET_NAMES,
  toggleScope,
} from '../../src/index.ts';

describe('access scopes', () => {
  test('split into what a person sees and what they may do', () => {
    expect(isViewScope('messages')).toBe(true);
    expect(isActionScope('messages')).toBe(false);
    expect(isActionScope('fork')).toBe(true);
    expect([...listViewScopes(ACCESS_SCOPES), ...listActionScopes(ACCESS_SCOPES)]).toEqual([
      ...ACCESS_SCOPES,
    ]);
  });

  test('every preset widens the one before it', () => {
    const [status, standard, collaborate, full] = [
      ACCESS_PRESETS.status,
      ACCESS_PRESETS.standard,
      ACCESS_PRESETS.collaborate,
      ACCESS_PRESETS.full,
    ];
    expect(status.every((scope) => standard.includes(scope))).toBe(true);
    expect(standard.every((scope) => collaborate.includes(scope))).toBe(true);
    expect(collaborate.every((scope) => full.includes(scope))).toBe(true);
    expect(hasScope(collaborate, 'message')).toBe(false);
    expect(hasScope(full, 'message')).toBe(true);
  });

  test('share presets are the view scopes of the same presets', () => {
    expect(SHARE_PRESET_GROUPS.standard).toEqual(listViewScopes(ACCESS_PRESETS.standard));
    expect(SHARE_PRESET_GROUPS.full).toContain('messages');
    expect(SHARE_PRESET_GROUPS.full.some(isActionScope)).toBe(false);
  });

  test('toggleScope turns one scope on in its place or off, and leaves the rest', () => {
    const off = toggleScope(ACCESS_PRESETS.collaborate, 'fork', false);
    expect(hasScope(off, 'fork')).toBe(false);
    expect(toggleScope(off, 'fork', true)).toEqual(ACCESS_PRESETS.collaborate);
    expect(toggleScope(off, 'fork', false)).toEqual(off);
  });

  test('resolvePreset names the preset that matches, or custom', () => {
    expect(resolvePreset(ACCESS_PRESETS.collaborate, TEAM_PRESET_NAMES)).toBe('collaborate');
    expect(resolvePreset(toggleScope(ACCESS_PRESETS.collaborate, 'fork', false), TEAM_PRESET_NAMES)).toBe(
      CUSTOM_PRESET
    );
    const actionsOnly = listActionScopes(ACCESS_PRESETS.full);
    expect(resolvePreset(actionsOnly, TEAM_PRESET_NAMES, listActionScopes)).toBe('full');
    expect(resolvePreset([], TEAM_PRESET_NAMES, listActionScopes)).toBe('standard');
  });
});
