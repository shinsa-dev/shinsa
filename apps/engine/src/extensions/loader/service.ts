import { readFileSync } from 'node:fs';
import { DomainError } from '@shinsa/core';
import { Context, Deferred, Duration, Effect, Exit, Layer, Option, Ref, Scope } from 'effect';
import { describeError } from '../../log/redact.ts';
import { McpClients } from '../health/service.ts';
import {
  MCP_CHECK_TIMEOUT,
  MCP_HOT_LOAD_TIMEOUT_MS,
  type McpDefinition,
  McpServerFailed,
  MCP_TOOL_CALL_TIMEOUT_MS,
} from '../schema.ts';
import { listToolInfo } from '../tools.ts';
import { listLoaderSpecs, resolveSkillBody, selectByName, serializeContent } from './names.ts';
import {
  type DeferredServer,
  ExtensionLoadFailed,
  type HotLoadSession,
  type LoadableExtensions,
  type LoaderClient,
  type LoaderFailure,
  type ServerLoad,
  type SessionLoader,
} from './schema.ts';

export class ExtensionLoader extends Context.Service<
  ExtensionLoader,
  { readonly create: (extensions: LoadableExtensions) => Effect.Effect<SessionLoader> }
>()('shinsa/engine/extensions/loader/ExtensionLoader') {
  static readonly layer = Layer.effect(
    ExtensionLoader,
    Effect.gen(function* () {
      const clients = yield* McpClients;

      const create = Effect.fn('ExtensionLoader.create')(function* (extensions: LoadableExtensions) {
        const session = yield* Ref.make(Option.none<HotLoadSession>());
        const loaded = yield* Ref.make<ReadonlySet<string>>(new Set());
        const loading = yield* Ref.make<ReadonlyMap<string, ServerLoad>>(new Map());
        const proxied = yield* Ref.make<ReadonlyMap<string, LoaderClient>>(new Map());
        const opened = yield* Ref.make<ReadonlySet<LoaderClient>>(new Set());
        const closed = yield* Ref.make(false);

        const without = <K, V>(entries: ReadonlyMap<K, V>, key: K) => {
          const next = new Map(entries);
          next.delete(key);
          return next;
        };

        const openThroughShinsa = Effect.fn('ExtensionLoader.openThroughShinsa')(function* (
          server: McpDefinition
        ) {
          const scope = yield* Scope.make();
          const { client } = yield* clients.open(server, MCP_CHECK_TIMEOUT).pipe(
            Scope.provide(scope),
            Effect.onError((cause) => Scope.close(scope, Exit.failCause(cause))),
            Effect.mapError((failed) => new ExtensionLoadFailed({ message: failed.message }))
          );
          const opening: LoaderClient = { client, close: Scope.close(scope, Exit.void) };
          return opening;
        });

        const findServer = Effect.fn('ExtensionLoader.findServer')(function* (wanted: string) {
          const server = selectByName(extensions.deferred, (entry) => [entry.name, entry.claudeName], wanted);
          if (server) return server;
          if (selectByName(extensions.loadedNames, (name) => [name], wanted) !== null) {
            return yield* new DomainError({
              code: 'server_loaded',
              message: `${wanted} is already loaded in this run. Use its tools.`,
            });
          }
          return yield* new DomainError({
            code: 'server_not_loadable',
            message: `There is no MCP server named ${wanted} to load. These can be loaded: ${extensions.deferred.map((entry) => entry.name).join(', ')}. A server turned off in Settings → Integrations stays off.`,
          });
        });

        const loadIntoSession = Effect.fn('ExtensionLoader.loadIntoSession')(function* (
          server: DeferredServer
        ) {
          const hot = Option.getOrUndefined(yield* Ref.get(session))?.loadMcpServers;
          if (!hot) return Option.none<string>();
          const abandon = new AbortController();
          return yield* hot([server], abandon.signal).pipe(
            Effect.mapError(
              (failed) => new McpServerFailed({ message: failed.message, unauthorized: false })
            ),
            Effect.timeoutOrElse({
              duration: MCP_HOT_LOAD_TIMEOUT_MS,
              orElse: () =>
                Effect.fail(
                  new McpServerFailed({
                    message: `No answer within ${Duration.toSeconds(MCP_HOT_LOAD_TIMEOUT_MS)} seconds.`,
                    unauthorized: false,
                  })
                ),
            }),
            Effect.flatMap((errors) => {
              const error = errors[server.claudeName] ?? null;
              if (error !== null) {
                return Effect.logWarning(
                  '[Extensions] A server did not load into the session; connecting through Shinsa'
                ).pipe(Effect.annotateLogs({ server: server.name, error }), Effect.as(Option.none<string>()));
              }
              const tools = server.tools.length > 0 ? ` Its tools: ${server.tools.join(', ')}.` : '';
              return Ref.update(loaded, (names) => new Set(names).add(server.name)).pipe(
                Effect.as(
                  Option.some(
                    `Loaded ${server.name}. Its tools are available to you now as mcp__${server.claudeName.replaceAll(':', '_')}__<tool>.${tools}`
                  )
                )
              );
            }),
            Effect.catchTag('McpServerFailed', (failed) =>
              Effect.sync(() => abandon.abort()).pipe(
                Effect.andThen(
                  Effect.logWarning(
                    '[Extensions] Could not load a server into the session; connecting through Shinsa'
                  ).pipe(Effect.annotateLogs({ server: server.name, error: failed.message }))
                ),
                Effect.as(Option.none<string>())
              )
            )
          );
        });

        const proxy = Effect.fn('ExtensionLoader.proxy')(function* (server: DeferredServer) {
          const client = yield* openThroughShinsa(server.definition);
          yield* Ref.update(opened, (current) => new Set(current).add(client));
          const listed = yield* clients
            .request(() => client.client.listTools(), MCP_HOT_LOAD_TIMEOUT_MS)
            .pipe(
              Effect.tap(() =>
                Effect.flatMap(Ref.get(closed), (ended) =>
                  ended
                    ? Effect.fail(new ExtensionLoadFailed({ message: 'This run has ended.' }))
                    : Effect.void
                )
              ),
              Effect.tapError(() =>
                Ref.update(opened, (current) => {
                  const next = new Set(current);
                  next.delete(client);
                  return next;
                }).pipe(Effect.andThen(client.close))
              )
            );
          yield* Ref.update(proxied, (connected) => new Map(connected).set(server.name, client));
          const tools = listed.tools.map((tool) => ({
            name: tool.name,
            description: listToolInfo([tool])[0]?.description ?? null,
            inputSchema: tool.inputSchema,
          }));
          return [
            `Connected to ${server.name} through Shinsa. Call its tools with call_mcp_tool, server "${server.name}":`,
            JSON.stringify(tools),
          ].join('\n');
        });

        const connect = Effect.fn('ExtensionLoader.connect')(function* (server: DeferredServer) {
          const intoSession = yield* loadIntoSession(server);
          if (Option.isSome(intoSession)) return intoSession.value;
          return yield* proxy(server);
        });

        const loadServer = Effect.fn('ExtensionLoader.loadServer')(function* (wanted: string) {
          const server = yield* findServer(wanted);
          if ((yield* Ref.get(loaded)).has(server.name) || (yield* Ref.get(proxied)).has(server.name)) {
            return `${server.name} is already loaded in this run.`;
          }
          const current = (yield* Ref.get(loading)).get(server.name);
          if (current) return yield* Deferred.await(current);
          const load = yield* Deferred.make<string, LoaderFailure>();
          yield* Ref.update(loading, (loads) => new Map(loads).set(server.name, load));
          return yield* connect(server).pipe(
            Effect.onExit((exit) =>
              Ref.update(loading, (loads) => without(loads, server.name)).pipe(
                Effect.andThen(Deferred.done(load, exit))
              )
            )
          );
        });

        const callTool = Effect.fn('ExtensionLoader.callTool')(function* (
          wanted: string,
          tool: string,
          args: unknown
        ) {
          const connected = yield* Ref.get(proxied);
          const serverName = selectByName([...connected.keys()], (name) => [name], wanted) ?? wanted;
          const client = connected.get(serverName);
          if (!client) {
            return yield* new DomainError({
              code: 'server_not_connected',
              message: `${serverName} is not connected through Shinsa. Load it with load_mcp_server first.`,
            });
          }
          const result = yield* clients.request(
            () =>
              client.client.callTool({
                name: tool,
                arguments: typeof args === 'object' && args !== null ? (args as Record<string, unknown>) : {},
              }),
            MCP_TOOL_CALL_TIMEOUT_MS
          );
          const text = serializeContent(result.content);
          if (result.isError) return yield* new ExtensionLoadFailed({ message: text || `${tool} failed.` });
          return text;
        });

        const loadSkill = Effect.fn('ExtensionLoader.loadSkill')(function* (wanted: string) {
          const skill = selectByName(extensions.deferredSkills, (entry) => [entry.name], wanted);
          if (!skill) {
            return yield* new DomainError({
              code: 'skill_not_loadable',
              message: `There is no skill named ${wanted} to load. These can be loaded: ${extensions.deferredSkills.map((entry) => entry.name).join(', ')}.`,
            });
          }
          const text = yield* Effect.try({
            try: () => readFileSync(skill.path, 'utf8'),
            catch: (error) => new ExtensionLoadFailed({ message: describeError(error) }),
          });
          return resolveSkillBody(text);
        });

        const handle = (name: string, input: Record<string, unknown>) => {
          if (name === 'load_mcp_server') return loadServer(String(input.name ?? ''));
          if (name === 'call_mcp_tool') {
            return callTool(String(input.server ?? ''), String(input.tool ?? ''), input.arguments);
          }
          return loadSkill(String(input.name ?? ''));
        };

        const close = Effect.gen(function* () {
          yield* Ref.set(closed, true);
          const ending = yield* Ref.getAndSet(opened, new Set());
          yield* Ref.set(proxied, new Map());
          yield* Effect.forEach(ending, (client) => client.close, {
            concurrency: 'unbounded',
            discard: true,
          });
        });

        const loader: SessionLoader = {
          specs: listLoaderSpecs(extensions),
          attach: (attached) => Ref.set(session, Option.some(attached)),
          handle,
          close,
        };
        return loader;
      });

      return ExtensionLoader.of({ create });
    })
  );
}
