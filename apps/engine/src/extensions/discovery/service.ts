import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveDisplayPath } from '@shinsa/core';
import { Context, Effect, Layer, Option, Schema } from 'effect';
import { JsonFile } from '../../files/service.ts';
import { describeError } from '../../log/redact.ts';
import {
  ClaudeConfig,
  type ClaudePlugin,
  ClaudeSettings,
  CodexConfig,
  type DiscoveredServer,
  type DiscoveryPaths,
  type FoundSkill,
  InstallEntry,
  InstalledPlugins,
  type MarkdownFile,
  McpJson,
  type PluginFiles,
  PluginManifest,
  type SkillRoot,
} from '../schema.ts';
import {
  listClaudeServers,
  listCodexServers,
  listPluginServers,
  listProjectServers,
  resolvePluginEntries,
} from './servers.ts';
import { resolveFoundSkill } from './skills.ts';

export class ExtensionDiscovery extends Context.Service<
  ExtensionDiscovery,
  {
    listPlugins(paths: DiscoveryPaths): Effect.Effect<{ plugins: ClaudePlugin[]; problems: string[] }>;
    listServers(
      paths: DiscoveryPaths,
      plugins: readonly ClaudePlugin[]
    ): Effect.Effect<{ servers: DiscoveredServer[]; problems: string[] }>;
    listSkills(roots: readonly SkillRoot[]): Effect.Effect<FoundSkill[]>;
    readPluginFiles(plugin: ClaudePlugin): Effect.Effect<PluginFiles>;
  }
>()('shinsa/engine/extensions/discovery/ExtensionDiscovery') {
  static readonly layer = Layer.effect(
    ExtensionDiscovery,
    Effect.gen(function* () {
      const files = yield* JsonFile;
      const decodeSettings = Schema.decodeUnknownOption(ClaudeSettings);
      const decodeInstalled = Schema.decodeUnknownOption(InstalledPlugins);
      const decodeInstall = Schema.decodeUnknownOption(InstallEntry);
      const decodeManifest = Schema.decodeUnknownOption(PluginManifest);
      const decodeConfig = Schema.decodeUnknownOption(ClaudeConfig);
      const decodeMcpJson = Schema.decodeUnknownOption(McpJson);
      const decodeCodex = Schema.decodeUnknownOption(CodexConfig);

      const describeProblem = (path: string, userHome: string, reason: string) =>
        `Could not read ${resolveDisplayPath(path, userHome)}: ${reason}`;

      const readJson = Effect.fn('ExtensionDiscovery.readJson')(function* (
        path: string,
        userHome: string,
        problems: string[]
      ) {
        return yield* files.read(path, Schema.Unknown).pipe(
          Effect.map(Option.getOrNull),
          Effect.catchTag('JsonFileUnreadable', (unreadable) =>
            Effect.sync(() => {
              problems.push(describeProblem(path, userHome, unreadable.reason));
              return null;
            })
          )
        );
      });

      const readToml = Effect.fn('ExtensionDiscovery.readToml')(function* (
        path: string,
        userHome: string,
        problems: string[]
      ) {
        if (!(yield* Effect.sync(() => existsSync(path)))) return null;
        return yield* Effect.try({
          try: (): unknown => Bun.TOML.parse(readFileSync(path, 'utf8')),
          catch: describeError,
        }).pipe(
          Effect.catch((reason) =>
            Effect.sync(() => {
              problems.push(describeProblem(path, userHome, reason));
              return null;
            })
          )
        );
      });

      const selectInstallRoot = (entries: readonly unknown[]) =>
        Effect.sync(
          () =>
            entries
              .flatMap((entry) => Option.toArray(decodeInstall(entry)))
              .find((entry) => existsSync(entry.installPath))?.installPath ?? null
        );

      const listPlugins = Effect.fn('ExtensionDiscovery.listPlugins')(function* (paths: DiscoveryPaths) {
        const problems: string[] = [];
        const settings = decodeSettings(
          yield* readJson(join(paths.claudeDir, 'settings.json'), paths.userHome, problems)
        );
        const enabled = Option.match(settings, {
          onNone: (): Record<string, unknown> => ({}),
          onSome: (read) => read.enabledPlugins ?? {},
        });
        const installed = decodeInstalled(
          yield* readJson(
            join(paths.claudeDir, 'plugins', 'installed_plugins.json'),
            paths.userHome,
            problems
          )
        );
        if (Option.isNone(installed)) return { plugins: [], problems };
        const plugins: ClaudePlugin[] = [];
        for (const [id, entries] of Object.entries(installed.value.plugins)) {
          const root = yield* selectInstallRoot(entries);
          if (!root) continue;
          const manifest = yield* readJson(
            join(root, '.claude-plugin', 'plugin.json'),
            paths.userHome,
            problems
          );
          plugins.push({
            id,
            name: id.split('@')[0] ?? id,
            root,
            enabled: enabled[id] === true,
            manifest: Option.getOrNull(decodeManifest(manifest)),
          });
        }
        return { plugins, problems };
      });

      const listServers = Effect.fn('ExtensionDiscovery.listServers')(function* (
        paths: DiscoveryPaths,
        plugins: readonly ClaudePlugin[]
      ) {
        const problems: string[] = [];
        const config = Option.getOrNull(
          decodeConfig(yield* readJson(paths.claudeConfig, paths.userHome, problems))
        );
        const servers = listClaudeServers(paths, config);
        for (const repo of paths.repos) {
          const file = join(repo, '.mcp.json');
          const project = decodeMcpJson(yield* readJson(file, paths.userHome, problems));
          if (Option.isSome(project)) {
            servers.push(...listProjectServers(paths, config, repo, file, project.value.mcpServers));
          }
        }
        const codexFile = join(paths.codexHome, 'config.toml');
        const codex = decodeCodex(yield* readToml(codexFile, paths.userHome, problems));
        if (Option.isSome(codex))
          servers.push(...listCodexServers(paths, codexFile, codex.value.mcp_servers ?? {}));
        for (const plugin of plugins) {
          const file = yield* readJson(join(plugin.root, '.mcp.json'), paths.userHome, problems);
          servers.push(...listPluginServers(plugin, resolvePluginEntries(plugin, file)));
        }
        return { servers, problems };
      });

      const listEntries = (dir: string) => Effect.sync(() => (existsSync(dir) ? readdirSync(dir) : []));

      const listSkills = Effect.fn('ExtensionDiscovery.listSkills')(function* (roots: readonly SkillRoot[]) {
        const listed = yield* Effect.forEach(roots, (root) =>
          Effect.map(listEntries(root.dir), (entries) => ({ root, entries }))
        );
        return yield* Effect.sync(() =>
          listed.flatMap(({ root, entries }) =>
            entries
              .filter((entry) => !entry.startsWith('.'))
              .sort()
              .flatMap((entry) => {
                const path = join(root.dir, entry, 'SKILL.md');
                if (!existsSync(path)) return [];
                return [resolveFoundSkill(root, entry, path, readFileSync(path, 'utf8'))];
              })
          )
        );
      });

      const listMarkdown = (dir: string) =>
        Effect.flatMap(listEntries(dir), (entries) =>
          Effect.sync((): MarkdownFile[] =>
            entries
              .filter((entry) => entry.endsWith('.md') && !entry.startsWith('.'))
              .sort()
              .map((entry) => ({ entry: entry.slice(0, -3), text: readFileSync(join(dir, entry), 'utf8') }))
          )
        );

      const readPluginFiles = Effect.fn('ExtensionDiscovery.readPluginFiles')(function* (
        plugin: ClaudePlugin
      ) {
        return yield* Effect.all({
          agents: listMarkdown(join(plugin.root, 'agents')),
          commands: listMarkdown(join(plugin.root, 'commands')),
          hooks: Effect.sync(() => existsSync(join(plugin.root, 'hooks', 'hooks.json'))),
        });
      });

      return ExtensionDiscovery.of({ listPlugins, listServers, listSkills, readPluginFiles });
    })
  );
}
