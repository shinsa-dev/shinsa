import {
  ACCESS_SCOPES,
  ACTION_SCOPES,
  CUSTOM_PRESET,
  type AccessPreset,
  type AccessScope,
  type AccessScopes,
  type ActionScope,
  type ResolvedPreset,
  type ViewScope,
} from './schema.ts';

export * from './schema.ts';

const STATUS_SCOPES: readonly ViewScope[] = ['identity', 'description', 'progress'];

const STANDARD_SCOPES: readonly ViewScope[] = [
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
];

const COLLABORATE_ACTIONS: readonly ActionScope[] = ['gates', 'actions', 'fork', 'share', 'services'];

export const ACCESS_PRESETS: Readonly<Record<AccessPreset, AccessScopes>> = {
  status: STATUS_SCOPES,
  standard: STANDARD_SCOPES,
  collaborate: [...STANDARD_SCOPES, ...COLLABORATE_ACTIONS],
  full: ACCESS_SCOPES,
};

const ACTION_SCOPE_SET: ReadonlySet<AccessScope> = new Set(ACTION_SCOPES);

export function isActionScope(scope: AccessScope): scope is ActionScope {
  return ACTION_SCOPE_SET.has(scope);
}

export function isViewScope(scope: AccessScope): scope is ViewScope {
  return !ACTION_SCOPE_SET.has(scope);
}

export function hasScope(scopes: AccessScopes, scope: AccessScope) {
  return scopes.includes(scope);
}

export function listViewScopes(scopes: AccessScopes): readonly ViewScope[] {
  return scopes.filter(isViewScope);
}

export function listActionScopes(scopes: AccessScopes): readonly ActionScope[] {
  return scopes.filter(isActionScope);
}

export function toggleScope(scopes: AccessScopes, scope: AccessScope, on: boolean): AccessScopes {
  const rest = scopes.filter((entry) => entry !== scope);
  return on ? ACCESS_SCOPES.filter((entry) => entry === scope || rest.includes(entry)) : rest;
}

function hasSameScopes(left: readonly AccessScope[], right: readonly AccessScope[]) {
  return left.length === right.length && left.every((scope) => right.includes(scope));
}

export function resolvePreset<P extends AccessPreset>(
  scopes: AccessScopes,
  presets: readonly P[],
  pick: (scopes: AccessScopes) => readonly AccessScope[] = (all) => all
): ResolvedPreset<P> {
  return presets.find((preset) => hasSameScopes(pick(scopes), pick(ACCESS_PRESETS[preset]))) ?? CUSTOM_PRESET;
}
