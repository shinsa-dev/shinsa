import {
  type ContextOptimizer,
  type ExtensionScope,
  type ExtensionsSnapshot,
  MCP_NAME_PATTERN,
  type McpServerInput,
  type McpServerPlace,
  type McpServerSummary,
  type McpSource,
  type McpTransport,
  type PluginSummary,
  resolveIdleDays,
  type ShinsaState,
  type SkillSummary,
} from '@shinsa/core';
import type { IconName } from '@shinsa/ui/components/icon';
import { formatCount } from '@/lib/format/count.ts';
import type { Tone } from '@/lib/format/tone.ts';
import { listProjects } from '@/lib/projects.ts';
import { resolveSettingsPath } from '@/lib/settings-tabs.ts';

export const EXTENSION_SECTION = { servers: 'MCP servers', plugins: 'Plugins', skills: 'Skills' } as const;

export type ExtensionKind = keyof typeof EXTENSION_SECTION;

export const EXTENSION_ICON: Record<ExtensionKind, IconName> = {
  servers: 'IconServer',
  plugins: 'IconPlugins',
  skills: 'IconMagicBook',
};

export const EXTENSION_LABEL = {
  addServer: 'Add server',
  addServerCommand: 'Add an MCP server',
  checkAll: 'Check all servers',
  checkNow: 'Check now',
  connect: 'Connect',
  signInAgain: 'Sign in again',
  signOut: 'Sign out',
  edit: 'Edit…',
  copy: 'Copy to Shinsa and edit…',
  remove: 'Remove',
  details: 'Show details',
  hideDetails: 'Hide details',
  options: 'Server options',
  useEverywhere: 'Use everywhere',
  useInProject: 'Use in one project',
  useInRepo: 'Use in one repository',
  pluginOff: 'Its plugin is off',
  notMeasured: 'Not measured',
  checking: 'Checking…',
  signInToMeasure: 'Sign in to measure',
  failingToMeasure: 'Can’t measure while failing',
  offNotMeasured: 'Not measured while off',
  search: 'Search servers, plugins and skills',
  nothingMatches: 'Nothing matches.',
  optimizerSection: 'Context optimizer',
  optimizerOn: 'Leave out servers agents haven’t used',
  optimizerOnHint: 'An agent loads a left-out server when its task needs one.',
  optimizerDays: 'Not used for',
  optimizerSkills: 'Leave out skills too',
  notUsedLately: 'Not used lately',
  readingUsage: 'Reading which servers and skills agents used…',
  allUsed: 'Agents used everything turned on here.',
  turnOff: 'Turn off',
  loadsWhenNeeded: 'Loads when needed',
  switchHint: 'Only for Shinsa’s agents. Claude Code and Codex keep their own settings.',
  noServers: 'No MCP servers yet.',
  noPlugins: 'Claude Code has no plugins installed.',
  noSkills: 'No skills found.',
  noProjects: 'No projects yet',
  noRepos: 'No repositories yet',
  keepSecret: 'Leave a value empty to keep the saved one.',
  argsHint: 'One argument per line.',
  unreadable: 'Couldn’t read the MCP servers, plugins and skills.',
} as const;

const SERVER_SOURCE: Record<Exclude<McpSource, 'plugin' | 'claude_project'>, string> = {
  shinsa: 'Shinsa',
  claude: 'Claude Code',
  project: 'Project .mcp.json',
  codex: 'Codex',
};

export function formatTokenEstimate(tokens: number) {
  if (tokens === 0) return 'No tokens';
  if (tokens < 1_000) return `~${Math.max(100, Math.round(tokens / 100) * 100)} tokens`;
  if (tokens < 9_950) return `~${(tokens / 1_000).toFixed(1).replace(/\.0$/, '')}k tokens`;
  return `~${Math.round(tokens / 1_000)}k tokens`;
}

export function resolveCostText(entry: { deferred: boolean }, cost: string) {
  return entry.deferred ? `${EXTENSION_LABEL.loadsWhenNeeded} · ${cost}` : cost;
}

export const SWITCH_LABEL: Record<ExtensionKind, (name: string) => string> = {
  servers: (name) => `Use ${name} for Shinsa’s agents`,
  plugins: (name) => `Use the ${name} plugin`,
  skills: (name) => `Use the ${name} skill`,
};

export function resolveTokenText(tokens: number | null) {
  return tokens === null ? EXTENSION_LABEL.notMeasured : formatTokenEstimate(tokens);
}

function selectPlugin(plugins: PluginSummary[], pluginId: string | null) {
  return plugins.find((plugin) => plugin.id === pluginId) ?? null;
}

export function isPluginOff(plugins: PluginSummary[], pluginId: string | null) {
  return selectPlugin(plugins, pluginId)?.enabled === false;
}

export function resolveServerSource(server: McpServerSummary, plugins: PluginSummary[]) {
  if (server.source === 'plugin') {
    const plugin = selectPlugin(plugins, server.plugin);
    return plugin ? `${plugin.name} plugin` : server.origin;
  }
  if (server.source === 'claude_project') return `Claude Code · ${server.origin}`;
  return SERVER_SOURCE[server.source];
}

export interface ServerStatusView {
  label: string;
  tone: Tone;
  detail: string | null;
}

const CLAUDE_CODE_SOURCES = new Set<McpServerSummary['source']>(['claude', 'claude_project', 'plugin']);

const CLAUDE_CODE_SIGN_IN =
  'Claude runs can still use a sign-in you made in Claude Code. Connect here for Codex and for Shinsa’s check.';

export function resolveServerStatus(server: McpServerSummary): ServerStatusView | null {
  const { status } = server;
  if (!server.enabled) return null;
  if (status.state === 'connected') {
    return {
      label: `Connected · ${formatCount(status.tools.length, 'tool', 'tools')}`,
      tone: 'green',
      detail: null,
    };
  }
  if (status.state === 'needs_sign_in') {
    return {
      label: 'Needs sign-in',
      tone: 'orange',
      detail: CLAUDE_CODE_SOURCES.has(server.source) ? CLAUDE_CODE_SIGN_IN : status.error,
    };
  }
  if (status.state === 'failing') {
    return {
      label: 'Failing',
      tone: 'red',
      detail: status.error ?? 'It did not answer when Shinsa checked it.',
    };
  }
  return null;
}

export function resolveServerCostHint(server: McpServerSummary) {
  const status = resolveServerStatus(server);
  if (!status || status.tone === 'red') return null;
  return status.detail;
}

export function needsConnect(server: McpServerSummary) {
  return server.enabled && server.transport !== 'stdio' && server.status.state === 'needs_sign_in';
}

export function resolveServerTarget(server: McpServerSummary) {
  if (server.transport === 'stdio') return [server.command ?? '', ...server.args].join(' ').trim();
  return server.url ?? '';
}

export function resolveShadowText(server: McpServerSummary, servers: McpServerSummary[]) {
  if (!server.shadowedBy) return null;
  const winner = servers.find((candidate) => candidate.id === server.shadowedBy);
  return `Overridden by Shinsa’s ${winner?.name ?? server.name}`;
}

export type ServerEditMode = Exclude<ServerDialogMode, 'add'>;

export const SERVER_EDIT: Record<ServerEditMode, { label: string; icon: IconName }> = {
  edit: { label: EXTENSION_LABEL.edit, icon: 'IconPencil' },
  copy: { label: EXTENSION_LABEL.copy, icon: 'IconClipboard2' },
};

export interface ServerMenu {
  connect: string | null;
  signOut: boolean;
  edit: ServerEditMode;
  remove: boolean;
}

function resolveConnectLabel(server: McpServerSummary) {
  if (server.transport === 'stdio') return null;
  return server.signedIn ? EXTENSION_LABEL.signInAgain : EXTENSION_LABEL.connect;
}

export function resolveServerMenu(server: McpServerSummary): ServerMenu {
  return {
    connect: resolveConnectLabel(server),
    signOut: server.signedIn,
    edit: server.editable ? 'edit' : 'copy',
    remove: server.editable,
  };
}

export interface ExtensionPlaces {
  projects: { id: string; name: string }[];
  repos: { path: string; name: string }[];
}

export function resolveExtensionPlaces(state: ShinsaState): ExtensionPlaces {
  return {
    projects: listProjects(state).map((project) => ({ id: project.id, name: project.name })),
    repos: Object.values(state.repos)
      .map((repo) => ({ path: repo.path, name: repo.name }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

function resolvePathName(path: string) {
  return path.split('/').filter(Boolean).at(-1) ?? path;
}

function resolveRepoName(places: ExtensionPlaces, path: string) {
  return places.repos.find((repo) => repo.path === path)?.name ?? resolvePathName(path);
}

function resolvePlaceText(scope: Exclude<ExtensionScope, { kind: 'everywhere' }>, places: ExtensionPlaces) {
  if (scope.kind === 'repo') return resolveRepoName(places, scope.path);
  const project = places.projects.find((entry) => entry.id === scope.project);
  return project ? `the ${project.name} project` : 'a project that is gone';
}

export function resolveScopeText(scope: ExtensionScope, places: ExtensionPlaces) {
  if (scope.kind === 'everywhere') return null;
  return `Only in ${resolvePlaceText(scope, places)}`;
}

export function describeScopeChanged(name: string, scope: ExtensionScope, places: ExtensionPlaces) {
  if (scope.kind === 'everywhere') return `Agents use ${name} everywhere.`;
  return `Agents use ${name} only in ${resolvePlaceText(scope, places)}.`;
}

export function serializeScope(scope: ExtensionScope) {
  if (scope.kind === 'everywhere') return 'everywhere';
  return scope.kind === 'project' ? `project:${scope.project}` : `repo:${scope.path}`;
}

export function parseScope(value: string): ExtensionScope {
  if (value.startsWith('project:')) return { kind: 'project', project: value.slice('project:'.length) };
  if (value.startsWith('repo:')) return { kind: 'repo', path: value.slice('repo:'.length) };
  return { kind: 'everywhere' };
}

export interface ScopeItem {
  value: string;
  label: string;
  icon: IconName;
}

export function listScopeItems(places: ExtensionPlaces, current: ExtensionScope): ScopeItem[] {
  const items: ScopeItem[] = [
    { value: 'everywhere', label: 'Everywhere', icon: 'IconGlobe' },
    ...places.projects.map((project) => ({
      value: serializeScope({ kind: 'project', project: project.id }),
      label: `Only in the ${project.name} project`,
      icon: 'IconLayersTwo' as const,
    })),
    ...places.repos.map((repo) => ({
      value: serializeScope({ kind: 'repo', path: repo.path }),
      label: `Only in ${repo.name}`,
      icon: 'IconFolder1' as const,
    })),
  ];
  const value = serializeScope(current);
  if (current.kind === 'everywhere' || items.some((item) => item.value === value)) return items;
  return [
    ...items,
    {
      value,
      label: resolveScopeText(current, places) ?? value,
      icon: current.kind === 'project' ? 'IconLayersTwo' : 'IconFolder1',
    },
  ];
}

function isSkillLoaded(skill: SkillSummary, plugins: PluginSummary[]) {
  return skill.enabled && !isPluginOff(plugins, skill.plugin);
}

export function describePluginContents(plugin: PluginSummary) {
  const parts = [
    plugin.skills > 0 ? formatCount(plugin.skills, 'skill', 'skills') : null,
    plugin.agents > 0 ? formatCount(plugin.agents, 'agent', 'agents') : null,
    plugin.commands > 0 ? formatCount(plugin.commands, 'command', 'commands') : null,
    plugin.hooks ? 'hooks' : null,
    plugin.servers > 0 ? formatCount(plugin.servers, 'MCP server', 'MCP servers') : null,
  ].filter((part) => part !== null);
  return parts.length > 0 ? parts.join(', ') : 'Nothing for agents to load';
}

export interface SkillGroup {
  id: string;
  title: string;
  skills: SkillSummary[];
  on: number;
  tokens: number;
}

const SKILL_SOURCE_ORDER: SkillSummary['source'][] = ['user', 'plugin', 'project', 'codex'];

const SKILL_SOURCE_TITLE: Record<Exclude<SkillSummary['source'], 'plugin' | 'project'>, string> = {
  shinsa: 'Shinsa',
  user: 'Claude Code on this machine',
  codex: 'Codex',
};

function resolveSkillGroupKey(skill: SkillSummary) {
  if (skill.source === 'plugin') return `plugin:${skill.plugin ?? skill.origin}`;
  if (skill.source === 'project') return `project:${skill.repoPath ?? skill.origin}`;
  return skill.source;
}

function resolveSkillGroupTitle(skill: SkillSummary, plugins: PluginSummary[], places: ExtensionPlaces) {
  if (skill.source === 'plugin') {
    const plugin = selectPlugin(plugins, skill.plugin);
    return plugin ? `${plugin.name} plugin` : skill.origin;
  }
  if (skill.source === 'project')
    return skill.repoPath ? resolveRepoName(places, skill.repoPath) : skill.origin;
  return SKILL_SOURCE_TITLE[skill.source];
}

export function listSkillGroups(
  snapshot: ExtensionsSnapshot,
  places: ExtensionPlaces,
  skills: SkillSummary[] = snapshot.skills
): SkillGroup[] {
  const groups = new Map<string, SkillGroup & { source: SkillSummary['source'] }>();
  for (const skill of skills) {
    if (skill.source === 'shinsa') continue;
    const key = resolveSkillGroupKey(skill);
    const group = groups.get(key) ?? {
      id: key,
      source: skill.source,
      title: resolveSkillGroupTitle(skill, snapshot.plugins, places),
      skills: [],
      on: 0,
      tokens: 0,
    };
    group.skills.push(skill);
    if (isSkillLoaded(skill, snapshot.plugins)) {
      group.on += 1;
      group.tokens += skill.tokens;
    }
    groups.set(key, group);
  }
  return [...groups.values()]
    .sort((a, b) => SKILL_SOURCE_ORDER.indexOf(a.source) - SKILL_SOURCE_ORDER.indexOf(b.source))
    .map(({ source: _source, ...group }) => group);
}

export function describeGroupCount(group: SkillGroup) {
  const count = `${group.on} of ${group.skills.length} on`;
  return group.tokens > 0 ? `${count} · ${formatTokenEstimate(group.tokens)}` : count;
}

export function describeServerToggled(name: string, enabled: boolean) {
  if (enabled) return `Turned on ${name} for Shinsa’s agents.`;
  return `Turned off ${name} for Shinsa’s agents. Claude Code and Codex keep their own settings.`;
}

export function describeSkillToggled(name: string, enabled: boolean) {
  return `Turned ${enabled ? 'on' : 'off'} the ${name} skill.`;
}

export function describePluginToggled(name: string, enabled: boolean) {
  return `Turned ${enabled ? 'on' : 'off'} the ${name} plugin.`;
}

export function describeChecked(server: McpServerSummary | null) {
  return server ? `Checked ${server.name}.` : 'Checked every server that is on.';
}

export function describeSignedIn(name: string) {
  return `Signed in to ${name}.`;
}

export function describeAlreadySignedIn(name: string) {
  return `${name} is already signed in.`;
}

export function describeSignInFailed(name: string) {
  return `Couldn’t sign in to ${name}. Try again.`;
}

export function describeSignedOut(name: string) {
  return `Signed out of ${name}.`;
}

export function describeServerRemoval(server: McpServerSummary) {
  return {
    title: `Remove ${server.name}?`,
    body: 'Agents stop using it, and Shinsa forgets its settings and saved secrets.',
    action: 'Remove server',
    done: `Removed ${server.name}.`,
  };
}

export type ServerDialogMode = 'add' | 'edit' | 'copy';

export type ServerDialogTarget =
  | { mode: 'add'; server: null }
  | { mode: ServerEditMode | 'remove'; server: McpServerSummary };

export function resolveCurrentServer(servers: McpServerSummary[], server: McpServerSummary) {
  return servers.find((entry) => entry.id === server.id) ?? server;
}

export interface ServerDialogCopy {
  title: string;
  description: string;
  action: string;
  done: string;
}

export function resolveServerDialog(
  mode: ServerDialogMode,
  server: McpServerSummary | null,
  plugins: PluginSummary[],
  name: string
): ServerDialogCopy {
  if (mode === 'add' || !server) {
    return {
      title: 'Add an MCP server',
      description: 'Agents can use it from their next run.',
      action: EXTENSION_LABEL.addServer,
      done: `Added ${name}.`,
    };
  }
  if (mode === 'edit') {
    return {
      title: `Edit ${server.name}`,
      description: 'Agents pick up the change on their next run.',
      action: 'Save server',
      done: `Saved ${name}.`,
    };
  }
  return {
    title: `Copy ${server.name} to Shinsa`,
    description: `Shinsa keeps its own copy under the same name and uses it instead of the one from ${resolveServerSource(server, plugins)}.`,
    action: 'Save copy',
    done: `Copied ${name} to Shinsa.`,
  };
}

export const TRANSPORT_ITEMS: { value: McpTransport; label: string; icon: IconName }[] = [
  { value: 'stdio', label: 'Command on this machine', icon: 'IconConsole' },
  { value: 'http', label: 'HTTP', icon: 'IconGlobe' },
  { value: 'sse', label: 'Server-sent events', icon: 'IconGlobe' },
];

export type ServerField = 'name' | 'command' | 'args' | 'env' | 'url' | 'headers';

export interface ServerDraft {
  name: string;
  transport: McpTransport;
  command: string;
  args: string;
  env: string;
  url: string;
  headers: string;
  scope: string;
}

export const SERVER_FIELD: Record<ServerField, { label: string; placeholder: string }> = {
  name: { label: 'Name', placeholder: '' },
  command: { label: 'Command', placeholder: '' },
  args: { label: 'Arguments', placeholder: '-y\n@modelcontextprotocol/server-github' },
  env: { label: 'Environment', placeholder: 'GITHUB_TOKEN=…' },
  url: { label: 'URL', placeholder: 'https://mcp.linear.app/mcp' },
  headers: { label: 'Headers', placeholder: 'Authorization: Bearer …' },
};

const MULTILINE_FIELDS = new Set<ServerField>(['args', 'env', 'headers']);

export function isMultilineField(field: ServerField) {
  return MULTILINE_FIELDS.has(field);
}

export function resolveFieldNote(field: ServerField, secrets: boolean) {
  if (field === 'args') return EXTENSION_LABEL.argsHint;
  if ((field === 'env' || field === 'headers') && secrets) return EXTENSION_LABEL.keepSecret;
  return null;
}

export function listDraftFields(transport: McpTransport): ServerField[] {
  return transport === 'stdio' ? ['name', 'command', 'args', 'env'] : ['name', 'url', 'headers'];
}

export function createServerDraft(server: McpServerSummary | null): ServerDraft {
  return {
    name: server?.name ?? '',
    transport: server?.transport ?? 'stdio',
    command: server?.command ?? '',
    args: server?.args.join('\n') ?? '',
    env: server?.envKeys.map((key) => `${key}=`).join('\n') ?? '',
    url: server?.url ?? '',
    headers: server?.headerKeys.map((key) => `${key}: `).join('\n') ?? '',
    scope: serializeScope(server?.scope ?? { kind: 'everywhere' }),
  };
}

export function hasSavedSecrets(server: McpServerSummary | null) {
  return (server?.envKeys.length ?? 0) + (server?.headerKeys.length ?? 0) > 0;
}

function listLines(text: string) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

function parsePairs(text: string, separator: string, key: RegExp) {
  const pairs: Record<string, string> = {};
  for (const line of listLines(text)) {
    const at = line.indexOf(separator);
    const name = at === -1 ? '' : line.slice(0, at).trim();
    if (!key.test(name)) return null;
    pairs[name] = line.slice(at + separator.length).trim();
  }
  return pairs;
}

const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

const HEADER_KEY = /^[A-Za-z0-9-]+$/;

function isWebUrl(text: string) {
  try {
    return ['http:', 'https:'].includes(new URL(text).protocol);
  } catch {
    return false;
  }
}

export type DraftCheck =
  | { ok: true; input: McpServerInput }
  | { ok: false; errors: Partial<Record<ServerField, string>> };

export function validateServerDraft(draft: ServerDraft): DraftCheck {
  const errors: Partial<Record<ServerField, string>> = {};
  const name = draft.name.trim();
  if (!name) errors.name = 'Enter a name.';
  else if (!MCP_NAME_PATTERN.test(name)) {
    errors.name = 'Use letters, numbers, - and _, starting with a letter or number.';
  }
  const scope = parseScope(draft.scope);
  if (draft.transport === 'stdio') {
    const command = draft.command.trim();
    const env = parsePairs(draft.env, '=', ENV_KEY);
    if (!command) errors.command = 'Enter the command that starts the server.';
    if (!env) errors.env = 'Write each variable as NAME=value on its own line.';
    if (errors.name || !command || !env) return { ok: false, errors };
    return {
      ok: true,
      input: { name, transport: 'stdio', command, args: listLines(draft.args), env, scope },
    };
  }
  const url = draft.url.trim();
  const headers = parsePairs(draft.headers, ':', HEADER_KEY);
  if (!isWebUrl(url)) errors.url = 'Enter a URL that starts with http:// or https://.';
  if (!headers) errors.headers = 'Write each header as Name: value on its own line.';
  if (errors.name || errors.url || !headers) return { ok: false, errors };
  return { ok: true, input: { name, transport: draft.transport, url, headers, scope } };
}

export type ServerGroupKey = 'connected' | 'failing' | 'needs_sign_in' | 'checking' | 'off';

export interface ServerStatusGroup {
  key: ServerGroupKey;
  title: string;
  servers: McpServerSummary[];
}

const SERVER_GROUP_TITLE: Record<ServerGroupKey, string> = {
  connected: 'Connected',
  failing: 'Failing',
  needs_sign_in: 'Needs sign-in',
  checking: 'Not checked yet',
  off: 'Off',
};

const SERVER_GROUP_ORDER: ServerGroupKey[] = ['connected', 'failing', 'needs_sign_in', 'checking', 'off'];

function resolveServerGroupKey(server: McpServerSummary, plugins: PluginSummary[]): ServerGroupKey {
  if (!server.enabled || isPluginOff(plugins, server.plugin)) return 'off';
  if (server.status.state === 'unchecked') return 'checking';
  return server.status.state;
}

export function listServerStatusGroups(servers: McpServerSummary[], plugins: PluginSummary[]) {
  return SERVER_GROUP_ORDER.flatMap((key): ServerStatusGroup[] => {
    const members = servers.filter((server) => resolveServerGroupKey(server, plugins) === key);
    return members.length > 0 ? [{ key, title: SERVER_GROUP_TITLE[key], servers: members }] : [];
  });
}

export const OPEN_GROUP_LIMIT = 6;

export function isServerGroupOpen(group: ServerStatusGroup) {
  if (group.key === 'connected' || group.key === 'needs_sign_in') return true;
  return group.servers.length <= OPEN_GROUP_LIMIT;
}

const SERVER_COST: Record<Exclude<ServerGroupKey, 'connected' | 'off'>, string> = {
  failing: EXTENSION_LABEL.failingToMeasure,
  needs_sign_in: EXTENSION_LABEL.signInToMeasure,
  checking: EXTENSION_LABEL.checking,
};

export function resolveServerCost(server: McpServerSummary, plugins: PluginSummary[]) {
  const key = resolveServerGroupKey(server, plugins);
  const { tokens } = server.status;
  if (key === 'connected') return resolveTokenText(tokens);
  if (key === 'off') return tokens === null ? EXTENSION_LABEL.offNotMeasured : formatTokenEstimate(tokens);
  return SERVER_COST[key];
}

function resolvePlaceSource(place: McpServerPlace, plugins: PluginSummary[]) {
  if (place.source === 'plugin') {
    const plugin = plugins.find((entry) => place.id.startsWith(`plugin:${entry.id}:`));
    return plugin ? `${plugin.name} plugin` : place.origin;
  }
  if (place.source === 'claude_project') return SERVER_SOURCE.claude;
  return SERVER_SOURCE[place.source];
}

export function describeServerSources(server: McpServerSummary, plugins: PluginSummary[]) {
  if (server.definedIn.length <= 1) return resolveServerSource(server, plugins);
  return [...new Set(server.definedIn.map((place) => resolvePlaceSource(place, plugins)))].join(', ');
}

export function describeServerPlaces(server: McpServerSummary) {
  if (server.definedIn.length <= 1) return server.origin;
  return `Defined in ${server.definedIn.map((place) => place.origin).join(', ')}`;
}

export function resolveUnusedDays(lastUsedAt: number | null, snapshot: ExtensionsSnapshot, now: number) {
  if (snapshot.usage.readAt === null) return null;
  return resolveIdleDays({ lastUsedAt, firstSeenAt: snapshot.usage.since }, now);
}

export function describeLastUsed(days: number | null) {
  if (days === null) return null;
  if (days === 0) return 'Used today';
  return `Not used in ${formatCount(days, 'day', 'days')}`;
}

export function listServerNotes(
  server: McpServerSummary,
  snapshot: ExtensionsSnapshot,
  places: ExtensionPlaces,
  now: number
) {
  return [
    describeServerPlaces(server),
    resolveScopeText(server.scope, places),
    resolveShadowText(server, snapshot.servers),
    isPluginOff(snapshot.plugins, server.plugin) ? EXTENSION_LABEL.pluginOff : null,
    describeLastUsed(resolveUnusedDays(server.lastUsedAt, snapshot, now)),
  ].filter((note) => note !== null);
}

export interface Recommendation {
  id: string;
  name: string;
  detail: string;
  tokens: number;
  server: McpServerSummary | null;
}

function isIdleFor(days: number | null, window: number): days is number {
  return days !== null && days >= window;
}

export function listRecommendations(snapshot: ExtensionsSnapshot, now: number): Recommendation[] {
  const window = snapshot.optimizer.days;
  const servers = snapshot.servers.flatMap((server): Recommendation[] => {
    if (resolveServerGroupKey(server, snapshot.plugins) === 'off' || server.status.tokens === null) return [];
    const days = resolveUnusedDays(server.lastUsedAt, snapshot, now);
    if (!isIdleFor(days, window)) return [];
    return [
      {
        id: server.id,
        name: server.name,
        detail: `${describeLastUsed(days)} · ${formatTokenEstimate(server.status.tokens)}`,
        tokens: server.status.tokens,
        server,
      },
    ];
  });
  const skills = snapshot.skills.filter(
    (skill) =>
      skill.source !== 'shinsa' &&
      isSkillLoaded(skill, snapshot.plugins) &&
      isIdleFor(resolveUnusedDays(skill.lastUsedAt, snapshot, now), window)
  );
  const skillTokens = skills.reduce((total, skill) => total + skill.tokens, 0);
  const skillRow: Recommendation[] =
    skills.length === 0
      ? []
      : [
          {
            id: 'skills',
            name: formatCount(skills.length, 'skill', 'skills'),
            detail: `Not used in ${formatCount(window, 'day', 'days')} · ${formatTokenEstimate(skillTokens)}`,
            tokens: skillTokens,
            server: null,
          },
        ];
  return [...servers, ...skillRow].sort((a, b) => b.tokens - a.tokens);
}

const OPTIMIZER_DAY_CHOICES = [7, 14, 30, 60, 90];

export function listOptimizerDayItems(current: number) {
  const days = [...new Set([...OPTIMIZER_DAY_CHOICES, current])].sort((a, b) => a - b);
  return days.map((value) => ({ value: String(value), label: formatCount(value, 'day', 'days') }));
}

export function describeOptimizerChanged(optimizer: ContextOptimizer, patch: Partial<ContextOptimizer>) {
  if (patch.enabled === true) {
    return `Agents now leave out servers unused for ${formatCount(optimizer.days, 'day', 'days')}.`;
  }
  if (patch.enabled === false) return 'Agents load every server that is turned on.';
  if (patch.skills !== undefined) {
    return patch.skills
      ? 'Agents leave out unused skills too.'
      : 'Agents load every skill that is turned on.';
  }
  return `Unused means not used for ${formatCount(patch.days ?? optimizer.days, 'day', 'days')}.`;
}

function isMatch(query: string, texts: (string | null)[]) {
  const haystack = texts
    .filter((text) => text !== null)
    .join(' ')
    .toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word));
}

export interface ExtensionMatches {
  servers: McpServerSummary[];
  plugins: PluginSummary[];
  skills: SkillSummary[];
  searching: boolean;
}

export function filterExtensions(snapshot: ExtensionsSnapshot, query: string): ExtensionMatches {
  const searching = query.trim() !== '';
  if (!searching) {
    return { servers: snapshot.servers, plugins: snapshot.plugins, skills: snapshot.skills, searching };
  }
  return {
    servers: snapshot.servers.filter((server) =>
      isMatch(query, [
        server.name,
        describeServerSources(server, snapshot.plugins),
        server.url,
        server.command,
      ])
    ),
    plugins: snapshot.plugins.filter((plugin) => isMatch(query, [plugin.name, plugin.id])),
    skills: snapshot.skills.filter((skill) => isMatch(query, [skill.name, skill.description, skill.origin])),
    searching,
  };
}

export function isEmptyMatch(matches: ExtensionMatches) {
  return (
    matches.servers.length === 0 &&
    matches.plugins.length === 0 &&
    matches.skills.every((skill) => skill.source === 'shinsa')
  );
}

export interface VisibleRange {
  start: number;
  end: number;
}

const VIRTUAL_OVERSCAN = 8;

export function resolveVisibleRange(
  listTop: number,
  viewportHeight: number,
  count: number,
  rowHeight: number
): VisibleRange {
  const first = Math.floor(-listTop / rowHeight) - VIRTUAL_OVERSCAN;
  const last = Math.ceil((viewportHeight - listTop) / rowHeight) + VIRTUAL_OVERSCAN;
  const start = Math.min(count, Math.max(0, first));
  return { start, end: Math.max(start, Math.min(count, last)) };
}

export const SEARCH_PARAM = 'q';

export const ADD_SERVER_PARAM = 'add';

export const ADD_SERVER_VALUE = 'mcp';

export function resolveAddServerPath() {
  const [path, hash] = resolveSettingsPath('integrations', EXTENSION_SECTION.servers).split('#');
  return `${path}&${ADD_SERVER_PARAM}=${ADD_SERVER_VALUE}#${hash}`;
}

export function resolvePathWithoutAdd(place: { pathname: string; search: string; hash: string }) {
  const params = new URLSearchParams(place.search);
  params.delete(ADD_SERVER_PARAM);
  const query = params.toString();
  return `${place.pathname}${query ? `?${query}` : ''}${place.hash}`;
}
