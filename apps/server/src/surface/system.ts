import type {
  AccountPatch,
  AccountSummary,
  AccountsSnapshot,
  AgentProviderInfo,
  OnBehalfAction,
  OnboardingStatus,
  ProgramVersion,
  QueueSummary,
  UpdateOutcome,
  VersionsSnapshot,
} from '@shinsa/core';
import { describeVersion, type ServerHealth } from '../instance/index.ts';
import type { FieldSpec, Values } from './fields.ts';
import { findAccount, resolveOptionalAccount } from './resolve.ts';
import { defineAction, defineRead, readValue, type SurfaceSpec } from './spec.ts';

const ACCOUNT_FIELD: FieldSpec = {
  name: 'account',
  kind: 'text',
  positional: 'one',
  required: true,
  description: 'The account (id or email).',
};

const ORIGINS = ['claude', 'cswap'] as const;

const PROGRAMS = ['claude', 'codex'] as const;

const UPTIME_UNITS = [
  { label: 'day', ms: 86_400_000 },
  { label: 'hour', ms: 3_600_000 },
  { label: 'minute', ms: 60_000 },
] as const;

interface Prerequisites {
  ready: boolean;
  checks: { label: string; ok: boolean; detail: string; fix: string | null }[];
}

function describeAccount(account: AccountSummary) {
  const flags = [
    account.isDefault ? 'default' : '',
    account.paused ? 'left out of new work' : '',
    account.signIn === 'signed_out' ? 'needs sign-in' : '',
  ].filter(Boolean);
  const highest = Math.max(0, ...account.usage.windows.map((window) => window.usedPercent));
  return `${account.id}  ${account.email ?? 'unknown email'}  ${account.plan ?? ''}  ${Math.round(highest)}% used${flags.length > 0 ? `  (${flags.join(', ')})` : ''}`;
}

function formatAccounts(snapshot: AccountsSnapshot) {
  const lines = snapshot.accounts.map(describeAccount);
  if (snapshot.login)
    lines.push(`Signing in: ${snapshot.login.phase}${snapshot.login.url ? ` at ${snapshot.login.url}` : ''}`);
  for (const found of snapshot.imports) lines.push(`Can import ${found.email} from ${found.origin}.`);
  return lines.length === 0 ? 'No Claude accounts.' : lines.join('\n');
}

function formatUsage(snapshot: AccountsSnapshot) {
  if (snapshot.accounts.length === 0) return 'No Claude accounts.';
  return snapshot.accounts
    .flatMap((account) => [
      `${account.email ?? account.id}${account.spentUntil ? ` (out of usage until ${new Date(account.spentUntil).toISOString()})` : ''}`,
      ...(account.usage.windows.length === 0
        ? [`  ${account.usage.detail ?? 'No usage reported yet.'}`]
        : account.usage.windows.map(
            (window) =>
              `  ${window.label}: ${Math.round(window.usedPercent)}%${window.resetsAt ? `, resets ${new Date(window.resetsAt).toISOString()}` : ''}`
          )),
    ])
    .join('\n');
}

function describeProgram(program: ProgramVersion) {
  const installed = program.override
    ? `runs ${program.override}`
    : (program.version ?? (program.path ? 'unknown version' : 'not installed'));
  const latest = program.latest ? `, latest ${program.latest}` : '';
  const action =
    program.status === 'outdated' || program.status === 'update_available'
      ? `  (update with \`shinsa versions update ${program.id}\`)`
      : '';
  return `${program.label}: ${installed}${latest}, needs ${program.minimum} or newer${action}`;
}

function formatVersions(snapshot: VersionsSnapshot) {
  const { sdk } = snapshot;
  return [
    ...snapshot.programs.map(describeProgram),
    `Claude Agent SDK: ${sdk.version}${sdk.latest ? `, latest ${sdk.latest}` : ''} (pairs with Claude Code ${sdk.claudeCodeVersion})`,
  ].join('\n');
}

function describeUptime(ms: number) {
  const unit = UPTIME_UNITS.find((candidate) => ms >= candidate.ms);
  if (!unit) return 'under a minute';
  const count = Math.floor(ms / unit.ms);
  return `${count} ${unit.label}${count === 1 ? '' : 's'}`;
}

function describeRunning(health: ServerHealth) {
  return `Shinsa ${describeVersion(health)} from ${health.installPath}, pid ${health.pid}, up ${describeUptime(health.uptimeMs)}. Data in ${health.dataDir}.`;
}

function buildAccountPatch(values: Values): AccountPatch {
  return {
    ...(values.default ? { isDefault: true as const } : {}),
    ...(typeof values.paused === 'boolean' ? { paused: values.paused } : {}),
    ...(values.switchAt === undefined
      ? {}
      : { switchAt: values.switchAt === 0 ? null : (values.switchAt as number) }),
    ...(values.position === undefined ? {} : { position: values.position as number }),
  };
}

export const SYSTEM_SPECS: SurfaceSpec[] = [
  defineRead<AccountsSnapshot>({
    path: ['accounts', 'list'],
    summary: 'List the Claude accounts agents run on.',
    fields: [],
    request: () => '/api/accounts',
    format: formatAccounts,
  }),
  defineAction({
    path: ['accounts', 'refresh'],
    summary: 'Check every account’s sign-in and usage again.',
    fields: [],
    act: async (client) => {
      const data = await client.post<AccountsSnapshot>('/api/accounts/refresh', {});
      return { data, text: formatAccounts(data) };
    },
  }),
  defineAction({
    path: ['accounts', 'sign-in'],
    summary: 'Sign in to a Claude account in the browser. Then pass the code with sign-in-code.',
    humanOnly: true,
    fields: [
      {
        name: 'account',
        kind: 'text',
        positional: 'one',
        description: 'An account to sign in again (id or email).',
      },
    ],
    act: async (client, values) => {
      const account = await resolveOptionalAccount(client, readValue(values, 'account'));
      const data = await client.post<AccountsSnapshot>('/api/accounts/login', {
        accountId: account?.id ?? null,
      });
      const login = data.login;
      return {
        data,
        text: login
          ? `Sign-in ${login.id}: ${login.url ?? 'starting'}. Then run \`shinsa accounts sign-in-code ${login.id} <code>\`.`
          : formatAccounts(data),
      };
    },
  }),
  defineAction({
    path: ['accounts', 'sign-in-code'],
    summary: 'Finish a sign-in with the code the browser showed.',
    humanOnly: true,
    fields: [
      { name: 'login', kind: 'text', positional: 'one', required: true, description: 'The sign-in id.' },
      { name: 'code', kind: 'text', positional: 'one', required: true, description: 'The code.' },
    ],
    act: async (client, values) => {
      const data = await client.post<AccountsSnapshot>('/api/accounts/login/code', {
        loginId: readValue(values, 'login'),
        code: readValue(values, 'code'),
      });
      return { data, text: formatAccounts(data) };
    },
  }),
  defineAction({
    path: ['accounts', 'import'],
    summary: 'Import a Claude login from Claude Code or claude-swap.',
    humanOnly: true,
    fields: [
      {
        name: 'origin',
        kind: 'choice',
        choices: ORIGINS,
        positional: 'one',
        required: true,
        description: 'claude or cswap.',
      },
      { name: 'email', kind: 'text', positional: 'one', required: true, description: 'The login’s email.' },
    ],
    act: async (client, values) => {
      const data = await client.post<AccountsSnapshot>('/api/accounts/import', {
        origin: values.origin,
        email: readValue(values, 'email'),
      });
      return { data, text: formatAccounts(data) };
    },
  }),
  defineAction({
    path: ['accounts', 'update'],
    summary:
      'Make an account the default, leave it out of new work, move it, or set when Shinsa switches away from it.',
    fields: [
      ACCOUNT_FIELD,
      { name: 'default', kind: 'boolean', description: 'Make it the default.' },
      {
        name: 'paused',
        kind: 'boolean',
        description: 'Leave it out of new work (true) or use it again (false).',
      },
      {
        name: 'switchAt',
        kind: 'integer',
        description: 'Switch away at this usage percentage; 0 uses the setting.',
      },
      { name: 'position', kind: 'integer', description: 'Its place in the list, from 0.' },
    ],
    act: async (client, values) => {
      const account = await findAccount(client, readValue(values, 'account'));
      const data = await client.post<AccountsSnapshot>('/api/accounts/update', {
        accountId: account.id,
        patch: buildAccountPatch(values),
      });
      return { data, text: formatAccounts(data) };
    },
  }),
  defineAction({
    path: ['accounts', 'remove'],
    summary: 'Remove an account from Shinsa. Your own Claude Code login is never signed out.',
    humanOnly: true,
    fields: [ACCOUNT_FIELD],
    act: async (client, values) => {
      const account = await findAccount(client, readValue(values, 'account'));
      const data = await client.post<AccountsSnapshot>('/api/accounts/remove', { accountId: account.id });
      return { data, text: formatAccounts(data) };
    },
  }),
  defineRead<AccountsSnapshot>({
    path: ['usage'],
    summary: 'Show how much of each usage limit every account has used, and when it resets.',
    fields: [],
    request: () => '/api/accounts',
    format: formatUsage,
  }),
  defineRead<AgentProviderInfo[]>({
    path: ['providers'],
    summary: 'List the agent providers and their models.',
    fields: [],
    request: () => '/api/providers',
    format: (providers) =>
      providers
        .map(
          (provider) =>
            `${provider.id} (${provider.label}): ${provider.models.map((model) => model.id).join(', ')}`
        )
        .join('\n'),
  }),
  defineRead<VersionsSnapshot>({
    path: ['versions', 'list'],
    summary:
      'Show the installed Claude Code and Codex, the latest of each and the Claude Agent SDK Shinsa runs.',
    fields: [],
    request: () => '/api/versions',
    format: formatVersions,
  }),
  defineAction({
    path: ['versions', 'update'],
    summary: 'Update Claude Code or Codex with its own updater.',
    humanOnly: true,
    fields: [
      {
        name: 'program',
        kind: 'choice',
        choices: PROGRAMS,
        positional: 'one',
        required: true,
        description: 'claude or codex.',
      },
    ],
    act: async (client, values) => {
      const data = await client.post<UpdateOutcome>('/api/versions/update', { program: values.program });
      return { data, text: `${data.message}\n${formatVersions(data.versions)}` };
    },
  }),
  defineRead<ServerHealth>({
    path: ['health'],
    summary: 'Check that Shinsa loaded its log cleanly, and which Shinsa is running.',
    fields: [],
    request: () => '/api/health',
    format: (health) =>
      [
        ...(health.ok
          ? [`Healthy. ${health.seq} events in the log.`]
          : [
              `Skipped ${health.problems.length} damaged entries at start:`,
              ...health.problems.map((problem) => `  #${problem.seq} ${problem.type}: ${problem.error}`),
            ]),
        describeRunning(health),
      ].join('\n'),
  }),
  defineRead<QueueSummary>({
    path: ['queue'],
    summary: 'What needs a decision, and what agents are working on.',
    fields: [],
    request: () => '/api/queue',
    format: (summary) =>
      [
        `Needs you (${summary.decisions.length})`,
        ...summary.decisions.map((entry) => `  ${entry.label.padEnd(9)} ${entry.title}  ${entry.url}`),
        `Agents working (${summary.working.length})`,
        ...summary.working.map((entry) => `  ${entry.label.padEnd(9)} ${entry.title}`),
      ].join('\n'),
  }),
  defineRead<{ actions: (OnBehalfAction & { byTask?: string | null })[] }>({
    path: ['activity'],
    summary: 'What agents did on your behalf, oldest first.',
    fields: [],
    request: () => '/api/activity',
    format: ({ actions }) =>
      actions.length === 0
        ? 'Nothing yet.'
        : actions
            .map((action) => {
              const from = action.byTask ? `  (the agent of ${action.byTask})` : '';
              return `${new Date(action.at).toISOString()}  ${action.summary}${from}`;
            })
            .join('\n'),
  }),
  defineRead<OnboardingStatus>({
    path: ['setup', 'status'],
    summary: 'Where setup stands, and where Shinsa keeps its data.',
    fields: [],
    request: () => '/api/onboarding',
    format: (status) =>
      [
        status.completed ? 'Setup is done.' : 'Setup is not finished.',
        `Data: ${status.paths.dataDir}`,
        `Config: ${status.paths.configPath}`,
      ].join('\n'),
  }),
  defineRead<Prerequisites>({
    path: ['setup', 'check'],
    summary: 'Check the tools Shinsa needs: git, gh, claude and bun.',
    fields: [],
    request: () => '/api/onboarding/prerequisites',
    format: (result) =>
      result.checks
        .map(
          (check) =>
            `${check.ok ? 'ok  ' : 'fail'} ${check.label}: ${check.detail}${check.fix ? ` (${check.fix})` : ''}`
        )
        .join('\n'),
  }),
];
