import { Schema } from 'effect';

export const VIEW_SCOPES = [
  'identity',
  'description',
  'requests',
  'progress',
  'summary',
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
  'messages',
] as const;

export type ViewScope = (typeof VIEW_SCOPES)[number];

export const ACTION_SCOPES = ['gates', 'actions', 'message', 'fork', 'share', 'services'] as const;

export type ActionScope = (typeof ACTION_SCOPES)[number];

export const ACCESS_SCOPES = [...VIEW_SCOPES, ...ACTION_SCOPES] as const;

export type AccessScope = ViewScope | ActionScope;

export const AccessScope = Schema.Literals(ACCESS_SCOPES);

export const AccessScopes = Schema.Array(AccessScope);

export type AccessScopes = readonly AccessScope[];

export const ACCESS_PRESET_NAMES = ['status', 'standard', 'collaborate', 'full'] as const;

export type AccessPreset = (typeof ACCESS_PRESET_NAMES)[number];

export const TEAM_PRESET_NAMES = [
  'standard',
  'collaborate',
  'full',
] as const satisfies readonly AccessPreset[];

export type TeamPreset = (typeof TEAM_PRESET_NAMES)[number];

export const CUSTOM_PRESET = 'custom';

export type ResolvedPreset<P extends AccessPreset> = P | typeof CUSTOM_PRESET;
