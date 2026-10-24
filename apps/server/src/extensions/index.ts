import { join } from 'node:path';
import {
  type ContextOptimizer,
  DomainError,
  type ExtensionPlace,
  type ExtensionScope,
  type ExtensionsSnapshot,
  isUnused,
  type McpServerStatus,
  type McpServerSummary,
  type ShinsaState,
  type SkillSummary,
  type UsageFacts,
} from '@shinsa/core';
import { resolveSharedConfigDir, resolveSharedGlobalConfig } from '../accounts/paths.ts';
import { resolveCodexHome } from '../agents/providers/codex/usage.ts';
import type { ServerConfig } from '../config/index.ts';
import { describeError, log } from '../log/index.ts';
import type { SecretStore } from '../secrets/store.ts';
import {
  type Catalog,
  type CatalogServer,
  type CatalogSkill,
  groupServers,
  isPluginOn,
  listUsedMembers,
  resolveClaudeName,
  resolveGroupScope,
  resolveRuntimeName,
  resolveWinners,
  type ServerGroup,
  selectGroup,
  selectMemberInPlace,
} from './catalog.ts';
import { type Env, expandDefinition, isFields } from './definitions.ts';
import { type DiscoveryPaths, discoverServers, listClaudePlugins } from './discover.ts';
import { createServerCheck, type ServerCheck } from './health.ts';
import {
  parseServerDefinition,
  parseServerName,
  parseServerScope,
  redactServerArgs,
  redactServerUrl,
} from './input.ts';
import type { OpenClient } from './loader.ts';
import { McpOAuth } from './oauth.ts';
import { resolvePluginSummary } from './plugins.ts';
import {
  createSessionLoader,
  listSkillsInPlace,
  type SessionExtensions,
  serializeSession,
} from './session.ts';
import { SIGN_IN_CALLBACK_PATH, serializeSignInPage } from './sign-in.ts';
import { discoverSkills } from './skills.ts';
import { ExtensionStore, isOptimizerDays, type StoredServer } from './store.ts';
import { UsageIndex } from './usage.ts';

export type { ServerCheck } from './health.ts';
export type { SessionExtensionSource, SessionExtensions } from './session.ts';

type FetchLike = (url: string | URL, init?: RequestInit) => Promise<Response>;

export interface ExtensionsOptions {
  state: () => ShinsaState;
  config: Pick<ServerConfig, 'home' | 'userHome' | 'pluginDir'> &
    Partial<Pick<ServerConfig, 'dataDir' | 'transcriptsDir'>>;
  secrets: SecretStore;
  baseUrl: () => string;
  env?: Env;
  check?: ServerCheck;
  now?: () => number;
  fetch?: FetchLike;
  usage?: UsageIndex;
  open?: OpenClient;
}

const UNCHECKED: McpServerStatus = {
  state: 'unchecked',
  error: null,
  checkedAt: null,
  tools: [],
  tokens: null,
};

const USAGE_MAX_AGE_MS = 10 * 60 * 1000;

const SEEN_BEFORE_WATCHING = 0;

export class Extensions {
  readonly #options: ExtensionsOptions;
  readonly #store: ExtensionStore;
  readonly #oauth: McpOAuth;
  readonly #check: ServerCheck;
  readonly #now: () => number;
  readonly #env: Env;
  readonly #usage: UsageIndex;

  constructor(options: ExtensionsOptions) {
    this.#options = options;
    this.#store = new ExtensionStore(join(options.config.home, 'extensions.json'));
    this.#now = options.now ?? Date.now;
    this.#env = options.env ?? process.env;
    this.#check = options.check ?? createServerCheck();
    this.#usage = options.usage ?? this.#createUsage();
    this.#oauth = new McpOAuth(options.secrets, {
      redirectUrl: () => `${options.baseUrl()}${SIGN_IN_CALLBACK_PATH}`,
      now: this.#now,
      ...(options.fetch ? { fetch: options.fetch } : {}),
    });
  }

  #createUsage() {
    const { config } = this.#options;
    const claudeDir = resolveSharedConfigDir(this.#env, config.userHome);
    return new UsageIndex({
      sources: [
        { dir: join(claudeDir, 'projects'), kind: 'claude' },
        ...(config.transcriptsDir ? [{ dir: config.transcriptsDir, kind: 'shinsa' as const }] : []),
      ],
      cachePath: config.dataDir ? join(config.dataDir, 'extension-usage.json') : null,
      now: this.#now,
    });
  }

  isCallback(pathname: string) {
    return pathname === SIGN_IN_CALLBACK_PATH;
  }

  syncUsage() {
    return this.#usage.refresh().catch((error: unknown) => {
      log.warn('[Extensions] Could not read which servers and skills agents used', {
        error: describeError(error),
      });
    });
  }

  stop() {
    return this.#usage.stop();
  }

  #paths(): DiscoveryPaths {
    const { userHome } = this.#options.config;
    return {
      userHome,
      claudeDir: resolveSharedConfigDir(this.#env, userHome),
      claudeConfig: resolveSharedGlobalConfig(this.#env, userHome),
      codexHome: resolveCodexHome({ CODEX_HOME: this.#env.CODEX_HOME, HOME: userHome }),
      repos: Object.values(this.#options.state().repos).map((repo) => repo.path),
    };
  }

  #catalog(): Catalog {
    const problems: string[] = [];
    const paths = this.#paths();
    const installed = listClaudePlugins(paths, problems);
    const own: CatalogServer[] = this.#store.listServers().map((server) => ({
      ...server,
      source: 'shinsa',
      origin: 'Shinsa',
      editable: true,
      plugin: null,
    }));
    const found: CatalogServer[] = discoverServers(paths, installed, problems).map((server) => {
      const choice = this.#store.selectChoice(server.id);
      return {
        ...server,
        enabled: choice.enabled ?? server.enabled,
        scope: choice.scope ?? server.scope ?? { kind: 'everywhere' },
        editable: false,
      };
    });
    const skills = discoverSkills(paths, installed, this.#options.config.pluginDir).map((skill) => ({
      ...skill,
      enabled: skill.source === 'shinsa' || (this.#store.selectSkill(skill.id) ?? true),
    }));
    const servers = [...own, ...found];
    const plugins = installed.map((plugin) => {
      const pluginSkills = skills.filter((skill) => skill.plugin === plugin.id);
      const skillTokens = pluginSkills
        .filter((skill) => skill.enabled)
        .reduce((total, skill) => total + skill.tokens, 0);
      const parts = {
        skills: pluginSkills.length,
        servers: servers.filter((server) => server.plugin === plugin.id).length,
        skillTokens,
      };
      const enabled = (this.#store.selectPlugin(plugin.id) ?? plugin.enabled) === true;
      const summary = resolvePluginSummary(plugin, parts, enabled, paths.userHome);
      return { ...plugin, summary, ownTokens: summary.tokens - skillTokens };
    });
    const groups = groupServers(servers);
    this.#store.recordSeen(
      [...groups.map((group) => group.key), ...skills.map((skill) => `skill:${skill.id}`)],
      this.#store.hasSeen() ? this.#now() : SEEN_BEFORE_WATCHING
    );
    return { servers, groups, skills, plugins, problems: [...new Set(problems)] };
  }

  #isSkillUsed(catalog: Catalog, skill: CatalogSkill) {
    return skill.enabled && (skill.source !== 'plugin' || isPluginOn(catalog, skill.plugin));
  }

  #status(group: ServerGroup): McpServerStatus {
    for (const id of [group.lead.id, ...group.members.map((member) => member.id)]) {
      const status = this.#store.selectStatus(id);
      if (status) return status;
    }
    return UNCHECKED;
  }

  #findGroup(catalog: Catalog, id: unknown) {
    const group = selectGroup(catalog.groups, id);
    if (!group) throw new DomainError('server_not_found', 'There is no MCP server with that id.');
    return group;
  }

  #selectSignedIn(group: ServerGroup) {
    return group.members.find((member) => this.#oauth.isSignedIn(member.id)) ?? null;
  }

  #resolveFirstSeen(key: string) {
    const seen = this.#store.selectSeen(key);
    if (seen === SEEN_BEFORE_WATCHING) return this.#usage.read().since;
    return seen;
  }

  #serverFacts(group: ServerGroup): UsageFacts {
    const uses = group.members
      .map((member) => this.#usage.selectServer(resolveRuntimeName(member)))
      .filter((at) => at !== null);
    return {
      lastUsedAt: uses.length > 0 ? Math.max(...uses) : null,
      firstSeenAt: this.#resolveFirstSeen(group.key),
    };
  }

  #skillFacts(skill: CatalogSkill): UsageFacts {
    return {
      lastUsedAt: this.#usage.selectSkill(skill.claudeName ?? skill.name),
      firstSeenAt: this.#resolveFirstSeen(`skill:${skill.id}`),
    };
  }

  #isReady() {
    return this.#usage.read().readAt !== null;
  }

  #isDeferredServer(optimizer: ContextOptimizer, group: ServerGroup) {
    if (!optimizer.enabled || !this.#isReady()) return false;
    return isUnused(this.#serverFacts(group), this.#now(), optimizer.days);
  }

  #isDeferredSkill(optimizer: ContextOptimizer, skill: CatalogSkill) {
    if (!optimizer.enabled || !optimizer.skills || skill.source === 'shinsa' || !this.#isReady())
      return false;
    return isUnused(this.#skillFacts(skill), this.#now(), optimizer.days);
  }

  #resolveServerSummary(
    catalog: Catalog,
    group: ServerGroup,
    winners: Map<string, ServerGroup>
  ): McpServerSummary {
    const { lead } = group;
    const enabled = listUsedMembers(catalog, group).length > 0;
    const winner = winners.get(resolveRuntimeName(lead));
    const { definition } = lead;
    return {
      id: lead.id,
      name: lead.name,
      source: lead.source,
      origin: lead.origin,
      transport: definition.transport,
      command: definition.command,
      args: redactServerArgs(definition.args),
      url: redactServerUrl(definition.url),
      envKeys: Object.keys(definition.env),
      headerKeys: Object.keys(definition.headers),
      enabled: group.members.some((member) => member.enabled),
      scope: resolveGroupScope(catalog, group),
      editable: lead.editable,
      shadowedBy: enabled && winner && winner !== group ? winner.lead.id : null,
      signedIn: this.#selectSignedIn(group) !== null,
      plugin: lead.plugin,
      status: this.#status(group),
      definedIn: group.members.map((member) => ({
        id: member.id,
        source: member.source,
        origin: member.origin,
        scope: member.scope,
        enabled: member.enabled,
      })),
      lastUsedAt: this.#serverFacts(group).lastUsedAt,
      deferred: enabled && this.#isDeferredServer(this.#store.selectOptimizer(), group),
    };
  }

  #resolveSkillSummary(catalog: Catalog, skill: CatalogSkill): SkillSummary {
    return {
      id: skill.id,
      name: skill.name,
      description: skill.description,
      source: skill.source,
      origin: skill.origin,
      plugin: skill.plugin,
      repoPath: skill.repoPath,
      enabled: skill.enabled,
      tokens: skill.tokens,
      lastUsedAt: this.#skillFacts(skill).lastUsedAt,
      deferred:
        this.#isSkillUsed(catalog, skill) && this.#isDeferredSkill(this.#store.selectOptimizer(), skill),
    };
  }

  snapshot(): ExtensionsSnapshot {
    if (this.#usage.isStale(USAGE_MAX_AGE_MS)) void this.syncUsage();
    const catalog = this.#catalog();
    const winners = resolveWinners(
      catalog.groups.filter((group) => listUsedMembers(catalog, group).length > 0)
    );
    return {
      servers: catalog.groups.map((group) => this.#resolveServerSummary(catalog, group, winners)),
      skills: catalog.skills.map((skill) => this.#resolveSkillSummary(catalog, skill)),
      plugins: catalog.plugins.map((plugin) => plugin.summary),
      problems: catalog.problems,
      optimizer: this.#store.selectOptimizer(),
      usage: this.#usage.read(),
    };
  }

  #parseName(value: unknown, keepId: string | null) {
    return parseServerName(value, (name) =>
      this.#store.listServers().some((server) => server.name === name && server.id !== keepId)
    );
  }

  #writeServer(server: StoredServer) {
    this.#store.upsertServer(server);
    const group = this.#findGroup(this.#catalog(), server.id);
    for (const member of group.members) this.#store.writeStatus(member.id, null);
    return this.snapshot();
  }

  createServer(fields: unknown) {
    if (!isFields(fields)) throw new DomainError('server_invalid', 'Describe the server to add.');
    const name = this.#parseName(fields.name, null);
    return this.#writeServer({
      id: `shinsa:${name}`,
      name,
      definition: parseServerDefinition(fields, null),
      enabled: fields.enabled !== false,
      scope:
        fields.scope === undefined
          ? { kind: 'everywhere' }
          : parseServerScope(fields.scope, this.#options.state()),
    });
  }

  updateServer(id: unknown, fields: unknown) {
    if (!isFields(fields)) throw new DomainError('server_invalid', 'Describe the server.');
    const group = this.#findGroup(this.#catalog(), id);
    const { lead } = group;
    const stored = lead.editable ? lead : null;
    const name = this.#parseName(fields.name ?? lead.name, stored?.id ?? null);
    const server: StoredServer = {
      id: stored && stored.name === name ? stored.id : `shinsa:${name}`,
      name,
      definition: parseServerDefinition(fields, lead.definition),
      enabled:
        typeof fields.enabled === 'boolean' ? fields.enabled : group.members.some((member) => member.enabled),
      scope: fields.scope === undefined ? lead.scope : parseServerScope(fields.scope, this.#options.state()),
    };
    if (stored && stored.id !== server.id) this.#store.removeServer(stored.id);
    return this.#writeServer(server);
  }

  removeServer(id: unknown) {
    const server = this.#findGroup(this.#catalog(), id).lead;
    if (!server.editable) {
      throw new DomainError(
        'server_not_removable',
        `${server.name} comes from ${server.origin}. Turn it off instead.`
      );
    }
    this.#store.removeServer(server.id);
    this.#oauth.signOut(server.id);
    return this.snapshot();
  }

  #updateMemberChoice(
    server: CatalogServer,
    enabled: boolean | undefined,
    scope: ExtensionScope | undefined
  ) {
    if (server.editable) {
      this.#store.upsertServer({
        id: server.id,
        name: server.name,
        definition: server.definition,
        enabled: enabled ?? server.enabled,
        scope: scope ?? server.scope,
      });
      return;
    }
    this.#store.updateChoice(server.id, {
      ...(enabled === undefined ? {} : { enabled }),
      ...(scope ? { scope } : {}),
    });
  }

  updateServerChoice(id: unknown, fields: unknown) {
    if (!isFields(fields)) throw new DomainError('server_invalid', 'Say what to change.');
    const group = this.#findGroup(this.#catalog(), id);
    const enabled = typeof fields.enabled === 'boolean' ? fields.enabled : undefined;
    const scope =
      fields.scope === undefined ? undefined : parseServerScope(fields.scope, this.#options.state());
    for (const member of group.members) this.#updateMemberChoice(member, enabled, scope);
    return this.snapshot();
  }

  updateSkillChoice(id: unknown, enabled: unknown) {
    if (typeof enabled !== 'boolean') throw new DomainError('skill_invalid', 'Turn the skill on or off.');
    const skill = this.#catalog().skills.find((entry) => entry.id === id);
    if (!skill) throw new DomainError('skill_not_found', 'There is no skill with that id.');
    if (skill.source === 'shinsa') {
      throw new DomainError('skill_built_in', 'Shinsa’s own skills are always on.');
    }
    this.#store.updateSkill(skill.id, enabled);
    return this.snapshot();
  }

  updatePluginChoice(id: unknown, enabled: unknown) {
    if (typeof enabled !== 'boolean') throw new DomainError('plugin_invalid', 'Turn the plugin on or off.');
    const plugin = this.#catalog().plugins.find((entry) => entry.id === id);
    if (!plugin) throw new DomainError('plugin_not_found', 'There is no plugin with that id.');
    this.#store.updatePlugin(plugin.id, enabled);
    return this.snapshot();
  }

  updateOptimizer(fields: unknown) {
    if (!isFields(fields)) throw new DomainError('optimizer_invalid', 'Say what to change.');
    const { enabled, days, skills } = fields;
    if (enabled !== undefined && typeof enabled !== 'boolean') {
      throw new DomainError('optimizer_invalid', 'Turn the optimizer on or off.');
    }
    if (skills !== undefined && typeof skills !== 'boolean') {
      throw new DomainError('optimizer_invalid', 'Say whether it also leaves out skills.');
    }
    if (days !== undefined && !isOptimizerDays(days)) {
      throw new DomainError('optimizer_invalid', 'Pick a whole number of days from 1 to 365.');
    }
    this.#store.updateOptimizer({
      ...(enabled === undefined ? {} : { enabled }),
      ...(days === undefined ? {} : { days }),
      ...(skills === undefined ? {} : { skills }),
    });
    return this.snapshot();
  }

  async #resolveDefinition(group: ServerGroup, member: CatalogServer = group.lead) {
    const definition = expandDefinition(member.definition, this.#env);
    if (definition.transport === 'stdio' || !definition.url) return definition;
    const signedIn = this.#selectSignedIn(group) ?? member;
    const token = await this.#oauth.resolveAccessToken(signedIn.id, definition.url);
    if (!token) return definition;
    return { ...definition, headers: { ...definition.headers, Authorization: `Bearer ${token}` } };
  }

  async #checkGroup(group: ServerGroup) {
    const status = await this.#check(await this.#resolveDefinition(group));
    this.#store.writeStatus(group.lead.id, { ...status, checkedAt: this.#now() });
  }

  async check(id?: unknown) {
    const catalog = this.#catalog();
    const groups =
      id === undefined || id === null
        ? catalog.groups.filter((group) => listUsedMembers(catalog, group).length > 0)
        : [this.#findGroup(catalog, id)];
    await Promise.all(groups.map((group) => this.#checkGroup(group)));
    return this.snapshot();
  }

  async startSignIn(id: unknown) {
    const group = this.#findGroup(this.#catalog(), id);
    const { lead } = group;
    const url = expandDefinition(lead.definition, this.#env).url;
    if (lead.definition.transport === 'stdio' || !url) {
      throw new DomainError('sign_in_unavailable', `${lead.name} runs on this machine and has no sign-in.`);
    }
    const member = this.#selectSignedIn(group) ?? lead;
    const authorizationUrl = await this.#oauth.start(member.id, url);
    if (authorizationUrl) return { authorizationUrl, snapshot: this.snapshot() };
    await this.#checkGroup(group);
    return { authorizationUrl: null, snapshot: this.snapshot() };
  }

  async finishSignIn(url: URL) {
    const state = url.searchParams.get('state') ?? '';
    const code = url.searchParams.get('code');
    const refused = url.searchParams.get('error_description') ?? url.searchParams.get('error');
    if (refused || !code) {
      return serializeSignInPage(
        'Sign-in did not finish',
        refused ?? 'The server sent no sign-in code. Connect again from Shinsa.',
        false
      );
    }
    try {
      const serverId = await this.#oauth.finish(state, code);
      const group = selectGroup(this.#catalog().groups, serverId);
      if (group) await this.#checkGroup(group);
      return serializeSignInPage(
        `Signed in to ${group?.lead.name ?? 'the server'}`,
        'You can close this tab and go back to Shinsa.',
        true
      );
    } catch (error) {
      log.warn('[Extensions] An MCP sign-in failed', { error: describeError(error) });
      return serializeSignInPage('Sign-in did not finish', describeError(error), false);
    }
  }

  signOut(id: unknown) {
    const group = this.#findGroup(this.#catalog(), id);
    for (const member of group.members) {
      this.#oauth.signOut(member.id);
      this.#store.writeStatus(member.id, null);
    }
    return this.snapshot();
  }

  async resolveSession(place: ExtensionPlace): Promise<SessionExtensions> {
    if (this.#isReady()) await this.syncUsage();
    const catalog = this.#catalog();
    const optimizer = this.#store.selectOptimizer();
    const inPlace = new Map(
      catalog.groups.flatMap((group) => {
        const member = selectMemberInPlace(catalog, group, place);
        return member ? [[group, member] as const] : [];
      })
    );
    const winners = [...resolveWinners([...inPlace.keys()]).values()];
    const resolveServer = async (group: ServerGroup) => ({
      name: resolveRuntimeName(group.lead),
      claudeName: resolveClaudeName(group.lead),
      definition: await this.#resolveDefinition(group, inPlace.get(group)),
      tokens: this.#status(group).tokens,
    });
    const servers = await Promise.all(
      winners.filter((group) => !this.#isDeferredServer(optimizer, group)).map(resolveServer)
    );
    const deferred = await Promise.all(
      winners
        .filter((group) => this.#isDeferredServer(optimizer, group))
        .map(async (group) => ({
          ...(await resolveServer(group)),
          tools: this.#status(group).tools.map((tool) => tool.name),
        }))
    );
    const skillsInPlace = listSkillsInPlace(catalog, place);
    const candidates = skillsInPlace.filter((skill) => this.#isSkillUsed(catalog, skill));
    return serializeSession({
      catalog,
      servers,
      deferred,
      inPlace: skillsInPlace,
      skills: candidates.filter((skill) => !this.#isDeferredSkill(optimizer, skill)),
      skippedSkills: candidates.filter((skill) => this.#isDeferredSkill(optimizer, skill)),
    });
  }

  createLoader(extensions: SessionExtensions) {
    return createSessionLoader(extensions, this.#options.open);
  }
}
