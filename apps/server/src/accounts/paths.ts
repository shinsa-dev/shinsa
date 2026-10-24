import { createHash } from 'node:crypto';
import { userInfo } from 'node:os';
import { join } from 'node:path';

export type Env = Record<string, string | undefined>;

export const DEFAULT_KEYCHAIN_SERVICE = 'Claude Code-credentials';

export const ACCOUNT_OWNED_ENTRIES = new Set([
  '.claude.json',
  '.config.json',
  '.credentials.json',
  '.oauth_refresh.lock',
  'backups',
  'statsig',
  'stats-cache.json',
  '.DS_Store',
]);

export const SEEDED_CONFIG_KEYS = [
  'mcpServers',
  'projects',
  'theme',
  'autoUpdates',
  'installMethod',
  'hasCompletedOnboarding',
  'lastOnboardingVersion',
  'githubRepoPaths',
] as const;

export function resolveAccountsDir(home: string) {
  return join(home, 'accounts');
}

export function resolveAccountDir(home: string, id: string) {
  return join(resolveAccountsDir(home), id);
}

export function resolveRegistryPath(home: string) {
  return join(home, 'accounts.json');
}

const LOGIN_OVERRIDES = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR',
  'CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR',
];

export function selectConfiguredDir(env: Env) {
  return env.CLAUDE_CONFIG_DIR?.trim() || null;
}

export function resolveSharedConfigDir(env: Env, userHome: string) {
  return selectConfiguredDir(env) ?? join(userHome, '.claude');
}

export function resolveSharedGlobalConfig(env: Env, userHome: string) {
  const configured = selectConfiguredDir(env);
  return configured ? join(configured, '.claude.json') : join(userHome, '.claude.json');
}

export function resolveAccountEnv(configDir: string | null): Env {
  if (configDir === null) return {};
  const cleared = Object.fromEntries(LOGIN_OVERRIDES.map((key) => [key, undefined]));
  return { ...cleared, CLAUDE_CONFIG_DIR: configDir };
}

export function resolveKeychainService(configDir: string | null) {
  if (configDir === null) return DEFAULT_KEYCHAIN_SERVICE;
  const digest = createHash('sha256').update(configDir.normalize('NFC'), 'utf8').digest('hex');
  return `${DEFAULT_KEYCHAIN_SERVICE}-${digest.slice(0, 8)}`;
}

export function resolveKeychainAccount(env: Env) {
  if (env.USER) return env.USER;
  try {
    return userInfo().username || 'claude-code-user';
  } catch {
    return 'claude-code-user';
  }
}
