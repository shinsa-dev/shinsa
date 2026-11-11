import {
  type AccountPatch,
  type AccountSummary,
  type AccountsSnapshot,
  type ProgramVersion,
  type QueueSummary,
  type QueueSummaryEntry,
  resolveTerminalLabel,
  type VersionsSnapshot,
} from '@shinsa/core';
import { DateTime, Effect } from 'effect';
import { ProviderChoice } from '../config/machine/schema.ts';
import { describeVersion, type ServerHealth } from '../instance/index.ts';
import {
  type Display,
  describeHeading,
  describeInline,
  describeMark,
  describeTable,
  type Tone,
} from '../terminal/index.ts';
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

function describeCheck(check: Prerequisites['checks'][number], display: Display) {
  const { style } = display;
  const fix = check.fix ? ` ${style.dim(`(${describeInline(style, check.fix)})`)}` : '';
  const text = `${check.label}: ${check.detail}${fix}`;
  if (style.symbols) {
    return describeMark(style, check.ok ? 'success' : 'danger', check.ok ? 'check' : 'cross', text);
  }
  return `${check.ok ? 'ok  ' : 'fail'} ${text}`;
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

function describeInstant(at: number) {
  return DateTime.formatIso(DateTime.makeUnsafe(at));
}

function formatAccounts(snapshot: AccountsSnapshot) {
  const lines = snapshot.accounts.map(describeAccount);
  if (snapshot.login)
    lines.push(`Signing in: ${snapshot.login.phase}${snapshot.login.url ? ` at ${snapshot.login.url}` : ''}`);
  for (const found of snapshot.imports) lines.push(`Can sign in to ${found.email} from claude-swap.`);
  return lines.length === 0 ? 'No Claude accounts.' : lines.join('\n');
}

function describeSignInStart(snapshot: AccountsSnapshot) {
  const login = snapshot.login;
  if (!login) return formatAccounts(snapshot);
  return `Sign-in ${login.id}: ${login.url ?? 'starting'}. Then run \`shinsa accounts sign-in-code ${login.id} <code>\`.`;
}

function formatUsage(snapshot: AccountsSnapshot) {
  if (snapshot.accounts.length === 0) return 'No Claude accounts.';
  return snapshot.accounts
    .flatMap((account) => [
      `${account.email ?? account.id}${account.spentUntil ? ` (out of usage until ${describeInstant(account.spentUntil)})` : ''}`,
      ...(account.usage.windows.length === 0
        ? [`  ${account.usage.detail ?? 'No usage reported yet.'}`]
        : account.usage.windows.map(
            (window) =>
              `  ${window.label}: ${Math.round(window.usedPercent)}%${window.resetsAt ? `, resets ${describeInstant(window.resetsAt)}` : ''}`
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

export function describeUptime(ms: number) {
  const unit = UPTIME_UNITS.find((candidate) => ms >= candidate.ms);
  if (!unit) return 'under a minute';
  const count = Math.floor(ms / unit.ms);
  return `${count} ${unit.label}${count === 1 ? '' : 's'}`;
}

const PAUSED_KINDS: ReadonlySet<QueueSummaryEntry['kind']> = new Set(['failure', 'configuration', 'sign_in']);

function resolveDecisionTone(entry: QueueSummaryEntry): Tone {
  if (PAUSED_KINDS.has(entry.kind)) return 'danger';
  return entry.kind === 'merge' ? 'success' : 'warning';
}

function describeQueueRow(entry: QueueSummaryEntry, tone: Tone, url: boolean) {
  const handle = entry.handle ?? entry.taskId.slice(0, 8);
  const row = [{ text: handle, tone: 'bold' as const }, { text: entry.label, tone }, entry.title];
  return url ? [...row, { text: entry.url, tone: 'dim' as const }] : row;
}

export function describeQueue(summary: QueueSummary, display: Display) {
  const decisions = summary.decisions.map((entry) =>
    describeQueueRow(entry, resolveDecisionTone(entry), true)
  );
  const working = summary.working.map((entry) => describeQueueRow(entry, 'accent', false));
  const lines = describeTable(display, { rows: [...decisions, ...working], fixed: [0, 1, 3], indent: 2 });
  return [
    ...(decisions.length > 0
      ? [describeHeading(display, 'Needs you', decisions.length), ...lines.slice(0, decisions.length)]
      : []),
    ...(decisions.length > 0 && working.length > 0 ? [''] : []),
    ...(working.length > 0
      ? [describeHeading(display, 'Agents working', working.length), ...lines.slice(decisions.length)]
      : []),
  ];
}

export const QUEUE_EMPTY = 'Nothing needs you, and no agent is working.';

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
  defineRead({
    path: ['accounts', 'list'],
    summary: 'List the Claude accounts agents run on.',
    fields: [],
    read: (_values, client) => client.api.accounts.list(),
    format: formatAccounts,
  }),
  defineAction({
    path: ['accounts', 'refresh'],
    summary: 'Check every account’s sign-in and usage again.',
    fields: [],
    act: Effect.fn('Surface.accountsRefresh')(function* (client) {
      const data = yield* client.api.accounts.refresh({ payload: {} });
      return { data, text: formatAccounts(data) };
    }),
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
    act: Effect.fn('Surface.accountsSignIn')(function* (client, values) {
      const account = yield* resolveOptionalAccount(client, readValue(values, 'account'));
      const data = yield* client.api.accounts.login({
        payload: {
          accountId: account?.id ?? null,
        },
      });
      return { data, text: describeSignInStart(data) };
    }),
  }),
  defineAction({
    path: ['accounts', 'sign-in-code'],
    summary: 'Finish a sign-in with the code the browser showed.',
    humanOnly: true,
    fields: [
      { name: 'login', kind: 'text', positional: 'one', required: true, description: 'The sign-in id.' },
      { name: 'code', kind: 'text', positional: 'one', required: true, description: 'The code.' },
    ],
    act: Effect.fn('Surface.accountsSignInCode')(function* (client, values) {
      const data = yield* client.api.accounts.loginCode({
        payload: {
          loginId: readValue(values, 'login'),
          code: readValue(values, 'code'),
        },
      });
      return { data, text: formatAccounts(data) };
    }),
  }),
  defineAction({
    path: ['accounts', 'import'],
    summary: 'Sign in to an account claude-swap has, as a login of its own.',
    humanOnly: true,
    fields: [
      {
        name: 'email',
        kind: 'text',
        positional: 'one',
        required: true,
        description: 'The account’s email in claude-swap.',
      },
    ],
    act: Effect.fn('Surface.accountsImport')(function* (client, values) {
      const data = yield* client.api.accounts.import({
        payload: {
          origin: 'cswap',
          email: readValue(values, 'email'),
        },
      });
      return { data, text: describeSignInStart(data) };
    }),
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
    act: Effect.fn('Surface.accountsUpdate')(function* (client, values) {
      const account = yield* findAccount(client, readValue(values, 'account'));
      const data = yield* client.api.accounts.update({
        payload: {
          accountId: account.id,
          patch: buildAccountPatch(values),
        },
      });
      return { data, text: formatAccounts(data) };
    }),
  }),
  defineAction({
    path: ['accounts', 'remove'],
    summary: 'Remove an account from Shinsa. Your own Claude Code login is never signed out.',
    humanOnly: true,
    fields: [ACCOUNT_FIELD],
    act: Effect.fn('Surface.accountsRemove')(function* (client, values) {
      const account = yield* findAccount(client, readValue(values, 'account'));
      const data = yield* client.api.accounts.remove({ payload: { accountId: account.id } });
      return { data, text: formatAccounts(data) };
    }),
  }),
  defineAction({
    path: ['accounts', 'provider'],
    summary:
      'Remove a provider such as Codex from Shinsa, or add it back. Its own sign-in is never signed out.',
    humanOnly: true,
    fields: [
      {
        name: 'provider',
        kind: 'text',
        positional: 'one',
        required: true,
        description: 'The provider, such as codex.',
      },
      {
        name: 'choice',
        kind: 'choice',
        choices: ProviderChoice.literals,
        required: true,
        description: 'removed forgets it; added shows it again.',
      },
    ],
    act: Effect.fn('Surface.accountsProvider')(function* (client, values) {
      const data = yield* client.api.accounts.provider({
        payload: { provider: readValue(values, 'provider'), choice: readValue(values, 'choice') },
      });
      return { data, text: formatAccounts(data) };
    }),
  }),
  defineRead({
    path: ['usage'],
    summary: 'Show how much of each usage limit every account has used, and when it resets.',
    fields: [],
    read: (_values, client) => client.api.accounts.list(),
    format: formatUsage,
  }),
  defineRead({
    path: ['providers'],
    summary: 'List the agent providers and their models.',
    fields: [],
    read: (_values, client) => client.api.server.providers(),
    format: (providers) =>
      providers
        .map(
          (provider) =>
            `${provider.id} (${provider.label}): ${provider.models.map((model) => model.id).join(', ')}`
        )
        .join('\n'),
  }),
  defineRead({
    path: ['versions', 'list'],
    summary:
      'Show the installed Claude Code and Codex, the latest of each and the Claude Agent SDK Shinsa runs.',
    fields: [],
    read: (_values, client) => client.api.versions.snapshot(),
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
    act: Effect.fn('Surface.versionsUpdate')(function* (client, values) {
      const data = yield* client.api.versions.update({ payload: { program: values.program } });
      return { data, text: `${data.message}\n${formatVersions(data.versions)}` };
    }),
  }),
  defineRead({
    path: ['terminals', 'list'],
    summary: 'List your terminals in Shinsa: each one’s folder and whether its shell still runs.',
    humanOnly: true,
    fields: [],
    read: (_values, client) => client.api.terminals.list(),
    format: ({ terminals }) =>
      terminals.length === 0
        ? 'No terminals.'
        : terminals
            .map(
              (terminal) =>
                `${resolveTerminalLabel(terminal).padEnd(24)} ${terminal.status.padEnd(8)} ${terminal.cwd}`
            )
            .join('\n'),
  }),
  defineRead({
    path: ['health'],
    summary: 'Check that Shinsa loaded its log cleanly, and which Shinsa is running.',
    fields: [],
    read: (_values, client) => Effect.map(client.api.server.health(), (health) => health as ServerHealth),
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
  defineRead({
    path: ['queue'],
    summary: 'What needs a decision, and what agents are working on.',
    fields: [],
    read: (_values, client) => client.api.server.queue(),
    format: (summary, _values, display) => {
      const lines = describeQueue(summary, display);
      return lines.length > 0 ? lines.join('\n') : QUEUE_EMPTY;
    },
  }),
  defineRead({
    path: ['activity'],
    summary: 'What agents did on your behalf, oldest first.',
    fields: [],
    read: (_values, client) => client.api.state.activity(),
    format: ({ actions }) =>
      actions.length === 0
        ? 'Nothing yet.'
        : actions
            .map((action) => {
              const from = action.byTask ? `  (the agent of ${action.byTask})` : '';
              return `${describeInstant(action.at)}  ${action.summary}${from}`;
            })
            .join('\n'),
  }),
  defineRead({
    path: ['setup', 'status'],
    summary: 'Where setup stands, and where Shinsa keeps its data.',
    fields: [],
    read: (_values, client) => client.api.onboarding.status(),
    format: (status) =>
      [
        status.completed ? 'Setup is done.' : 'Setup is not finished.',
        `Data: ${status.paths.dataDir}`,
        `Config: ${status.paths.configPath}`,
      ].join('\n'),
  }),
  defineRead({
    path: ['setup', 'check'],
    summary: 'Check the tools Shinsa needs: git, gh, claude and bun.',
    fields: [],
    read: (_values, client) =>
      Effect.map(client.api.onboarding.prerequisites(), (result) => result as Prerequisites),
    format: (result, _values, display) =>
      result.checks.map((check) => describeCheck(check, display)).join('\n'),
  }),
];
