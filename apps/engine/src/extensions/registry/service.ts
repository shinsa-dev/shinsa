import {
  type ContextOptimizer,
  DomainError,
  type ExtensionPlace,
  type ExtensionScope,
  type ExtensionsSnapshot,
  isUnused,
  type LoadedExtensions,
  type McpServerStatus,
  type McpServerSummary,
  type SkillSummary,
  type UsageFacts,
} from '@shinsa/core';
import { Cause, Duration, Effect, FiberSet, Option, Ref } from 'effect';
import { resolveSharedConfigDir, resolveSharedGlobalConfig } from '../../accounts/paths.ts';
import { resolveCodexHome } from '../../agents/providers/codex/usage.ts';
import { describeError } from '../../log/redact.ts';
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
} from '../catalog.ts';
import { expandDefinition, isFields, resolveBrowserEnv } from '../definitions.ts';
import { serializePluginSummary } from '../discovery/plugins.ts';
import { ExtensionDiscovery } from '../discovery/service.ts';
import { listSkillRoots } from '../discovery/skills.ts';
import { McpClients } from '../health/service.ts';
import {
  parseServerDefinition,
  parseServerName,
  parseServerScope,
  redactServerArgs,
  redactServerUrl,
} from '../input.ts';
import { makeMcpOAuth } from '../oauth/service.ts';
import {
  type DiscoveryPaths,
  MCP_CHECK_TIMEOUT,
  type McpDefinition,
  SIGN_IN_PENDING_MS,
  type StoredServer,
  USAGE_MAX_AGE_MS,
} from '../schema.ts';
import { listSkillsInPlace, resolvePinnedDeferral, serializeSession } from '../session.ts';
import { serializeSignInPage } from '../sign-in.ts';
import { isOptimizerDays } from '../store.ts';
import {
  type ExtensionsDefinition,
  type ExtensionsHandle,
  SEEN_BEFORE_WATCHING,
  UNCHECKED_STATUS,
  type UsageView,
} from './schema.ts';

export const makeExtensions = Effect.fn('Extensions.make')(function* (definition: ExtensionsDefinition) {
  const discovery = yield* ExtensionDiscovery;
  const clients = yield* McpClients;
  const lifetime = yield* Effect.scope;
  const { store, usage, config, env } = definition;
  const oauth = yield* makeMcpOAuth({
    store: definition.secrets,
    redirectUrl: definition.redirectUrl,
    now: definition.now,
    random: definition.random,
    fetch: definition.fetch,
    pendingMs: SIGN_IN_PENDING_MS,
  });
  const cached = yield* Ref.make(Option.none<ExtensionsSnapshot>());
  const stopped = yield* Ref.make(false);
  const refreshPending = yield* Ref.make(false);
  const refreshes = yield* FiberSet.make<void>();
  const checkServer =
    definition.check ?? ((server: McpDefinition) => clients.check(server, MCP_CHECK_TIMEOUT));

  const fail = (code: string, message: string) => new DomainError({ code, message });

  const parseInput = <A>(parse: () => A) =>
    Effect.try({
      try: parse,
      catch: (error) => (error instanceof DomainError ? error : fail('server_invalid', describeError(error))),
    });

  const readUsage = Effect.all({ view: usage.view, now: definition.now });

  const syncSnapshot = Effect.gen(function* () {
    if ((yield* Ref.get(refreshPending)) || (yield* Ref.get(stopped))) return;
    yield* Ref.set(refreshPending, true);
    yield* FiberSet.run(
      refreshes,
      Effect.sleep(Duration.zero).pipe(
        Effect.andThen(Ref.set(refreshPending, false)),
        Effect.andThen(definition.refresh),
        Effect.catch((failure) =>
          Effect.logWarning('[Extensions] Could not refresh the MCPs, plugins and skills').pipe(
            Effect.annotateLogs({ error: failure.message })
          )
        )
      )
    );
  });

  const syncUsage = usage.refresh.pipe(
    Effect.andThen(
      Effect.flatMap(Ref.get(cached), (snapshot) => (Option.isSome(snapshot) ? syncSnapshot : Effect.void))
    ),
    Effect.catch((failure) =>
      Effect.logWarning('[Extensions] Could not read which servers and skills agents used').pipe(
        Effect.annotateLogs({ error: failure.message })
      )
    )
  );

  const stop = Effect.gen(function* () {
    yield* Ref.set(stopped, true);
    yield* FiberSet.clear(refreshes);
    yield* Ref.set(refreshPending, false);
    yield* usage.stop;
  });

  const resolvePaths = Effect.fn('Extensions.resolvePaths')(function* () {
    const { userHome } = config;
    const state = yield* definition.state;
    const paths: DiscoveryPaths = {
      userHome,
      claudeDir: resolveSharedConfigDir(env, userHome),
      claudeConfig: resolveSharedGlobalConfig(env, userHome),
      codexHome: resolveCodexHome({ CODEX_HOME: env.CODEX_HOME, HOME: userHome }),
      repos: Object.values(state.repos).map((repo) => repo.path),
    };
    return paths;
  });

  const readCatalog = Effect.fn('Extensions.readCatalog')(function* () {
    const paths = yield* resolvePaths();
    const installed = yield* discovery.listPlugins(paths);
    const discovered = yield* discovery.listServers(paths, installed.plugins);
    const own: CatalogServer[] = store.listServers().map((server) => ({
      ...server,
      source: 'shinsa',
      origin: 'Shinsa',
      editable: true,
      plugin: null,
    }));
    const found: CatalogServer[] = discovered.servers.map((server) => {
      const choice = store.selectChoice(server.id);
      return {
        ...server,
        enabled: choice.enabled ?? server.enabled,
        scope: choice.scope ?? server.scope ?? { kind: 'everywhere' },
        editable: false,
      };
    });
    const listed = yield* discovery.listSkills(listSkillRoots(paths, installed.plugins, config.pluginDir));
    const skills = listed.map((skill) => ({
      ...skill,
      enabled: skill.source === 'shinsa' || (store.selectSkill(skill.id) ?? true),
    }));
    const servers = [...own, ...found];
    const plugins = yield* Effect.forEach(installed.plugins, (plugin) =>
      Effect.map(discovery.readPluginFiles(plugin), (files) => {
        const pluginSkills = skills.filter((skill) => skill.plugin === plugin.id);
        const skillTokens = pluginSkills
          .filter((skill) => skill.enabled)
          .reduce((total, skill) => total + skill.tokens, 0);
        const parts = {
          skills: pluginSkills.length,
          servers: servers.filter((server) => server.plugin === plugin.id).length,
          skillTokens,
        };
        const enabled = (store.selectPlugin(plugin.id) ?? plugin.enabled) === true;
        const summary = serializePluginSummary(plugin, files, parts, enabled, paths.userHome);
        return { ...plugin, summary, ownTokens: summary.tokens - skillTokens };
      })
    );
    const groups = groupServers(servers);
    const seenAt = store.hasSeen() ? yield* definition.now : SEEN_BEFORE_WATCHING;
    store.recordSeen(
      [...groups.map((group) => group.key), ...skills.map((skill) => `skill:${skill.id}`)],
      seenAt
    );
    const problems = [...new Set([...installed.problems, ...discovered.problems])];
    const catalog: Catalog = { servers, groups, skills, plugins, problems };
    return catalog;
  });

  const isSkillUsed = (catalog: Catalog, skill: CatalogSkill) =>
    skill.enabled && (skill.source !== 'plugin' || isPluginOn(catalog, skill.plugin));

  const resolveStatus = (group: ServerGroup): McpServerStatus => {
    for (const id of [group.lead.id, ...group.members.map((member) => member.id)]) {
      const status = store.selectStatus(id);
      if (status) return status;
    }
    return UNCHECKED_STATUS;
  };

  const findGroup = Effect.fn('Extensions.findGroup')(function* (catalog: Catalog, id: unknown) {
    const group = selectGroup(catalog.groups, id);
    if (!group) return yield* fail('server_not_found', 'There is no MCP with that id.');
    return group;
  });

  const selectSignedIn = Effect.fn('Extensions.selectSignedIn')(function* (group: ServerGroup) {
    for (const member of group.members) if (yield* oauth.isSignedIn(member.id)) return member;
    return null;
  });

  const resolveFirstSeen = (view: UsageView, key: string) => {
    const seen = store.selectSeen(key);
    return seen === SEEN_BEFORE_WATCHING ? view.read.since : seen;
  };

  const resolveServerFacts = (view: UsageView, group: ServerGroup): UsageFacts => {
    const uses = group.members
      .map((member) => view.selectServer(resolveRuntimeName(member)))
      .filter((at) => at !== null);
    return {
      lastUsedAt: uses.length > 0 ? Math.max(...uses) : null,
      firstSeenAt: resolveFirstSeen(view, group.key),
    };
  };

  const resolveSkillFacts = (view: UsageView, skill: CatalogSkill): UsageFacts => ({
    lastUsedAt: view.selectSkill(skill.claudeName ?? skill.name),
    firstSeenAt: resolveFirstSeen(view, `skill:${skill.id}`),
  });

  const isReady = (view: UsageView) => view.read.readAt !== null;

  const isDeferredServer = (
    reading: { view: UsageView; now: number },
    optimizer: ContextOptimizer,
    group: ServerGroup,
    pin: LoadedExtensions | null = null
  ) => {
    if (!optimizer.enabled) return false;
    const pinned = resolvePinnedDeferral(pin, 'servers', resolveClaudeName(group.lead));
    if (pinned !== null) return pinned;
    if (!isReady(reading.view)) return false;
    return isUnused(resolveServerFacts(reading.view, group), reading.now, optimizer.days);
  };

  const isDeferredSkill = (
    reading: { view: UsageView; now: number },
    optimizer: ContextOptimizer,
    skill: CatalogSkill,
    pin: LoadedExtensions | null = null
  ) => {
    if (!optimizer.enabled || !optimizer.skills || skill.source === 'shinsa') return false;
    const pinned = resolvePinnedDeferral(pin, 'skills', skill.claudeName ?? skill.name);
    if (pinned !== null) return pinned;
    if (!isReady(reading.view)) return false;
    return isUnused(resolveSkillFacts(reading.view, skill), reading.now, optimizer.days);
  };

  const resolveServerSummary = Effect.fn('Extensions.resolveServerSummary')(function* (
    catalog: Catalog,
    group: ServerGroup,
    winners: Map<string, ServerGroup>,
    reading: { view: UsageView; now: number }
  ) {
    const { lead } = group;
    const enabled = listUsedMembers(catalog, group).length > 0;
    const winner = winners.get(resolveRuntimeName(lead));
    const { definition: server } = lead;
    const summary: McpServerSummary = {
      id: lead.id,
      name: lead.name,
      source: lead.source,
      origin: lead.origin,
      transport: server.transport,
      command: server.command,
      args: redactServerArgs(server.args),
      url: redactServerUrl(server.url),
      envKeys: Object.keys(server.env),
      headerKeys: Object.keys(server.headers),
      enabled: group.members.some((member) => member.enabled),
      scope: resolveGroupScope(catalog, group),
      editable: lead.editable,
      shadowedBy: enabled && winner && winner !== group ? winner.lead.id : null,
      signedIn: (yield* selectSignedIn(group)) !== null,
      plugin: lead.plugin,
      status: resolveStatus(group),
      definedIn: group.members.map((member) => ({
        id: member.id,
        source: member.source,
        origin: member.origin,
        scope: member.scope,
        enabled: member.enabled,
      })),
      lastUsedAt: resolveServerFacts(reading.view, group).lastUsedAt,
      deferred: enabled && isDeferredServer(reading, store.selectOptimizer(), group),
    };
    return summary;
  });

  const resolveSkillSummary = (
    catalog: Catalog,
    skill: CatalogSkill,
    reading: { view: UsageView; now: number }
  ): SkillSummary => ({
    id: skill.id,
    name: skill.name,
    description: skill.description,
    source: skill.source,
    origin: skill.origin,
    plugin: skill.plugin,
    repoPath: skill.repoPath,
    enabled: skill.enabled,
    tokens: skill.tokens,
    lastUsedAt: resolveSkillFacts(reading.view, skill).lastUsedAt,
    deferred: isSkillUsed(catalog, skill) && isDeferredSkill(reading, store.selectOptimizer(), skill),
  });

  const snapshot = Effect.gen(function* () {
    if (yield* usage.isStale(USAGE_MAX_AGE_MS)) yield* Effect.forkIn(syncUsage, lifetime);
    const catalog = yield* readCatalog();
    const reading = yield* readUsage;
    const winners = resolveWinners(
      catalog.groups.filter((group) => listUsedMembers(catalog, group).length > 0)
    );
    const servers = yield* Effect.forEach(catalog.groups, (group) =>
      resolveServerSummary(catalog, group, winners, reading)
    );
    const next: ExtensionsSnapshot = {
      servers,
      skills: catalog.skills.map((skill) => resolveSkillSummary(catalog, skill, reading)),
      plugins: catalog.plugins.map((plugin) => plugin.summary),
      problems: catalog.problems,
      optimizer: store.selectOptimizer(),
      usage: reading.view.read,
    };
    yield* Ref.set(cached, Option.some(next));
    return next;
  });

  const readSnapshot = Effect.gen(function* () {
    const current = yield* Ref.get(cached);
    if (Option.isNone(current)) return yield* snapshot;
    yield* syncSnapshot;
    return current.value;
  });

  const parseName = (value: unknown, keepId: string | null) =>
    parseInput(() =>
      parseServerName(value, (name) =>
        store.listServers().some((server) => server.name === name && server.id !== keepId)
      )
    );

  const parseScope = Effect.fn('Extensions.parseScope')(function* (value: unknown) {
    const state = yield* definition.state;
    return yield* parseInput(() => parseServerScope(value, state));
  });

  const writeServer = Effect.fn('Extensions.writeServer')(function* (server: StoredServer) {
    store.upsertServer(server);
    const group = yield* findGroup(yield* readCatalog(), server.id);
    for (const member of group.members) store.writeStatus(member.id, null);
    return yield* snapshot;
  });

  const createServer = Effect.fn('Extensions.createServer')(function* (fields: unknown) {
    if (!isFields(fields)) return yield* fail('server_invalid', 'Describe the MCP to add.');
    const name = yield* parseName(fields.name, null);
    const parsed = yield* parseInput(() => parseServerDefinition(fields, null));
    return yield* writeServer({
      id: `shinsa:${name}`,
      name,
      definition: parsed,
      enabled: fields.enabled !== false,
      scope: fields.scope === undefined ? { kind: 'everywhere' } : yield* parseScope(fields.scope),
    });
  });

  const updateServer = Effect.fn('Extensions.updateServer')(function* (id: unknown, fields: unknown) {
    if (!isFields(fields)) return yield* fail('server_invalid', 'Describe the MCP.');
    const group = yield* findGroup(yield* readCatalog(), id);
    const { lead } = group;
    const stored = lead.editable ? lead : null;
    const name = yield* parseName(fields.name ?? lead.name, stored?.id ?? null);
    const server: StoredServer = {
      id: stored && stored.name === name ? stored.id : `shinsa:${name}`,
      name,
      definition: yield* parseInput(() => parseServerDefinition(fields, lead.definition)),
      enabled:
        typeof fields.enabled === 'boolean' ? fields.enabled : group.members.some((member) => member.enabled),
      scope: fields.scope === undefined ? lead.scope : yield* parseScope(fields.scope),
    };
    if (stored && stored.id !== server.id) store.removeServer(stored.id);
    return yield* writeServer(server);
  });

  const removeServer = Effect.fn('Extensions.removeServer')(function* (id: unknown) {
    const server = (yield* findGroup(yield* readCatalog(), id)).lead;
    if (!server.editable) {
      return yield* fail('server_not_removable', `It comes from ${server.origin}. Turn it off.`);
    }
    store.removeServer(server.id);
    yield* oauth.signOut(server.id);
    return yield* snapshot;
  });

  const updateMemberChoice = (
    server: CatalogServer,
    enabled: boolean | undefined,
    scope: ExtensionScope | undefined
  ) => {
    if (server.editable) {
      store.upsertServer({
        id: server.id,
        name: server.name,
        definition: server.definition,
        enabled: enabled ?? server.enabled,
        scope: scope ?? server.scope,
      });
      return;
    }
    store.updateChoice(server.id, {
      ...(enabled === undefined ? {} : { enabled }),
      ...(scope ? { scope } : {}),
    });
  };

  const updateServerChoice = Effect.fn('Extensions.updateServerChoice')(function* (
    id: unknown,
    fields: unknown
  ) {
    if (!isFields(fields)) return yield* fail('server_invalid', 'Say what to change.');
    const group = yield* findGroup(yield* readCatalog(), id);
    const enabled = typeof fields.enabled === 'boolean' ? fields.enabled : undefined;
    const scope = fields.scope === undefined ? undefined : yield* parseScope(fields.scope);
    for (const member of group.members) updateMemberChoice(member, enabled, scope);
    return yield* snapshot;
  });

  const updateSkillChoice = Effect.fn('Extensions.updateSkillChoice')(function* (
    id: unknown,
    enabled: unknown
  ) {
    if (typeof enabled !== 'boolean') return yield* fail('skill_invalid', 'Turn the skill on or off.');
    const skill = (yield* readCatalog()).skills.find((entry) => entry.id === id);
    if (!skill) return yield* fail('skill_not_found', 'There is no skill with that id.');
    if (skill.source === 'shinsa') return yield* fail('skill_built_in', 'Shinsa’s own skills are always on.');
    store.updateSkill(skill.id, enabled);
    return yield* snapshot;
  });

  const updatePluginChoice = Effect.fn('Extensions.updatePluginChoice')(function* (
    id: unknown,
    enabled: unknown
  ) {
    if (typeof enabled !== 'boolean') return yield* fail('plugin_invalid', 'Turn the plugin on or off.');
    const plugin = (yield* readCatalog()).plugins.find((entry) => entry.id === id);
    if (!plugin) return yield* fail('plugin_not_found', 'There is no plugin with that id.');
    store.updatePlugin(plugin.id, enabled);
    return yield* snapshot;
  });

  const updateOptimizer = Effect.fn('Extensions.updateOptimizer')(function* (fields: unknown) {
    if (!isFields(fields)) return yield* fail('optimizer_invalid', 'Say what to change.');
    const { enabled, days, skills } = fields;
    if (enabled !== undefined && typeof enabled !== 'boolean') {
      return yield* fail('optimizer_invalid', 'Turn the optimizer on or off.');
    }
    if (skills !== undefined && typeof skills !== 'boolean') {
      return yield* fail('optimizer_invalid', 'Say whether it also leaves out skills.');
    }
    if (days !== undefined && !isOptimizerDays(days)) {
      return yield* fail('optimizer_invalid', 'Pick 1 to 365 days.');
    }
    store.updateOptimizer({
      ...(enabled === undefined ? {} : { enabled }),
      ...(days === undefined ? {} : { days }),
      ...(skills === undefined ? {} : { skills }),
    });
    return yield* snapshot;
  });

  const resolveDefinition = Effect.fn('Extensions.resolveDefinition')(function* (
    group: ServerGroup,
    member: CatalogServer = group.lead
  ) {
    const expanded = expandDefinition(member.definition, env);
    if (expanded.transport === 'stdio') {
      return { ...expanded, env: resolveBrowserEnv(expanded.env, expanded.args) };
    }
    if (!expanded.url) return expanded;
    const signedIn = (yield* selectSignedIn(group)) ?? member;
    const token = yield* oauth.resolveAccessToken(signedIn.id, expanded.url);
    if (!token) return expanded;
    return { ...expanded, headers: { ...expanded.headers, Authorization: `Bearer ${token}` } };
  });

  const checkGroup = Effect.fn('Extensions.checkGroup')(function* (group: ServerGroup) {
    const status = yield* checkServer(yield* resolveDefinition(group));
    store.writeStatus(group.lead.id, { ...status, checkedAt: yield* definition.now });
  });

  const check = Effect.fn('Extensions.check')(function* (id?: unknown) {
    const catalog = yield* readCatalog();
    const groups =
      id === undefined || id === null
        ? catalog.groups.filter((group) => listUsedMembers(catalog, group).length > 0)
        : [yield* findGroup(catalog, id)];
    yield* Effect.forEach(groups, checkGroup, { concurrency: 'unbounded', discard: true });
    return yield* snapshot;
  });

  const startSignIn = Effect.fn('Extensions.startSignIn')(function* (id: unknown) {
    const group = yield* findGroup(yield* readCatalog(), id);
    const { lead } = group;
    const url = expandDefinition(lead.definition, env).url;
    if (lead.definition.transport === 'stdio' || !url) {
      return yield* fail('sign_in_unavailable', 'It runs here and has no sign-in.');
    }
    const member = (yield* selectSignedIn(group)) ?? lead;
    const authorizationUrl = yield* oauth.start(member.id, url);
    if (authorizationUrl) return { authorizationUrl, snapshot: yield* snapshot };
    yield* checkGroup(group);
    return { authorizationUrl: null, snapshot: yield* snapshot };
  });

  const completeSignIn = Effect.fn('Extensions.completeSignIn')(function* (state: string, code: string) {
    const serverId = yield* oauth.finish(state, code);
    const group = selectGroup((yield* readCatalog()).groups, serverId);
    if (group) yield* checkGroup(group);
    yield* Ref.set(cached, Option.none());
    return serializeSignInPage(
      `Signed in to ${group?.lead.name ?? 'the server'}`,
      'You can close this tab and go back to Shinsa.',
      true
    );
  });

  const finishSignIn = Effect.fn('Extensions.finishSignIn')(function* (url: URL) {
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
    return yield* completeSignIn(state, code).pipe(
      Effect.catchCause((cause) => {
        const error = describeError(Cause.squash(cause));
        return Effect.logWarning('[Extensions] An MCP sign-in failed').pipe(
          Effect.annotateLogs({ error }),
          Effect.as(serializeSignInPage('Sign-in did not finish', error, false))
        );
      })
    );
  });

  const signOut = Effect.fn('Extensions.signOut')(function* (id: unknown) {
    const group = yield* findGroup(yield* readCatalog(), id);
    for (const member of group.members) {
      yield* oauth.signOut(member.id);
      store.writeStatus(member.id, null);
    }
    return yield* snapshot;
  });

  const resolveSession = Effect.fn('Extensions.resolveSession')(function* (
    place: ExtensionPlace,
    pin: LoadedExtensions | null
  ) {
    if (isReady(yield* usage.view)) yield* syncUsage;
    const catalog = yield* readCatalog();
    const reading = yield* readUsage;
    const optimizer = store.selectOptimizer();
    const inPlace = new Map(
      catalog.groups.flatMap((group) => {
        const member = selectMemberInPlace(catalog, group, place);
        return member ? [[group, member] as const] : [];
      })
    );
    const winners = [...resolveWinners([...inPlace.keys()]).values()];
    const isDeferred = (group: ServerGroup) => isDeferredServer(reading, optimizer, group, pin);
    const resolveServer = Effect.fn('Extensions.resolveServer')(function* (group: ServerGroup) {
      return {
        name: resolveRuntimeName(group.lead),
        claudeName: resolveClaudeName(group.lead),
        definition: yield* resolveDefinition(group, inPlace.get(group)),
        tokens: resolveStatus(group).tokens,
      };
    });
    const servers = yield* Effect.forEach(
      winners.filter((group) => !isDeferred(group)),
      resolveServer,
      { concurrency: 'unbounded' }
    );
    const deferred = yield* Effect.forEach(
      winners.filter(isDeferred),
      (group) =>
        Effect.map(resolveServer(group), (server) => ({
          ...server,
          tools: resolveStatus(group).tools.map((tool) => tool.name),
        })),
      { concurrency: 'unbounded' }
    );
    const skillsInPlace = listSkillsInPlace(catalog, place);
    const candidates = skillsInPlace.filter((skill) => isSkillUsed(catalog, skill));
    return serializeSession({
      catalog,
      servers,
      deferred,
      inPlace: skillsInPlace,
      skills: candidates.filter((skill) => !isDeferredSkill(reading, optimizer, skill, pin)),
      skippedSkills: candidates.filter((skill) => isDeferredSkill(reading, optimizer, skill, pin)),
    });
  });

  const handle: ExtensionsHandle = {
    syncUsage,
    stop,
    readSnapshot,
    syncSnapshot,
    snapshot,
    createServer,
    updateServer,
    removeServer,
    updateServerChoice,
    updateSkillChoice,
    updatePluginChoice,
    updateOptimizer,
    check,
    startSignIn,
    finishSignIn,
    signOut,
    resolveSession,
  };
  return handle;
});
