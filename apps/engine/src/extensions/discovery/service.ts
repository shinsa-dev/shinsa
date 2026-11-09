import { join } from 'node:path';
import { resolveDisplayPath } from '@shinsa/core';
import { Context, Effect, FileSystem, flow, Layer, Option, Schema } from 'effect';
import { isPresent as isPathPresent, selectText as selectPathText } from '../../files/probe.ts';
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
      const fs = yield* FileSystem.FileSystem;
      const decodeSettings = Schema.decodeUnknownOption(ClaudeSettings);
      const decodeInstalled = Schema.decodeUnknownOption(InstalledPlugins);
      const decodeInstall = Schema.decodeUnknownOption(InstallEntry);
      const decodeManifest = Schema.decodeUnknownOption(PluginManifest);
      const decodeConfig = Schema.decodeUnknownOption(ClaudeConfig);
      const decodeMcpJson = Schema.decodeUnknownOption(McpJson);
      const decodeCodex = Schema.decodeUnknownOption(CodexConfig);

      const withFiles = Effect.provideService(FileSystem.FileSystem, fs);
      const isPresent = flow(isPathPresent, withFiles);
      const selectText = flow(selectPathText, withFiles);

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
        if (!(yield* isPresent(path))) return null;
        return yield* fs.readFileString(path).pipe(
          Effect.mapError(describeError),
          Effect.flatMap((text) =>
            Effect.try({ try: (): unknown => Bun.TOML.parse(text), catch: describeError })
          ),
          Effect.catch((reason) =>
            Effect.sync(() => {
              problems.push(describeProblem(path, userHome, reason));
              return null;
            })
          )
        );
      });

      const selectInstallRoot = Effect.fn('ExtensionDiscovery.selectInstallRoot')(function* (
        entries: readonly unknown[]
      ) {
        const roots = entries.flatMap((entry) => Option.toArray(decodeInstall(entry)));
        for (const { installPath } of roots) if (yield* isPresent(installPath)) return installPath;
        return null;
      });

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

      const listEntries = (dir: string) =>
        fs.readDirectory(dir).pipe(
          Effect.map((entries) => entries.filter((entry) => !entry.startsWith('.')).sort()),
          Effect.orElseSucceed((): string[] => [])
        );

      const listSkills = Effect.fn('ExtensionDiscovery.listSkills')(function* (roots: readonly SkillRoot[]) {
        const found: FoundSkill[] = [];
        for (const root of roots) {
          for (const entry of yield* listEntries(root.dir)) {
            const path = join(root.dir, entry, 'SKILL.md');
            const text = yield* selectText(path);
            if (Option.isSome(text)) found.push(resolveFoundSkill(root, entry, path, text.value));
          }
        }
        return found;
      });

      const listMarkdown = Effect.fn('ExtensionDiscovery.listMarkdown')(function* (dir: string) {
        const found: MarkdownFile[] = [];
        for (const entry of yield* listEntries(dir)) {
          if (!entry.endsWith('.md')) continue;
          const text = yield* selectText(join(dir, entry));
          if (Option.isSome(text)) found.push({ entry: entry.slice(0, -3), text: text.value });
        }
        return found;
      });

      const readPluginFiles = Effect.fn('ExtensionDiscovery.readPluginFiles')(function* (
        plugin: ClaudePlugin
      ) {
        return yield* Effect.all({
          agents: listMarkdown(join(plugin.root, 'agents')),
          commands: listMarkdown(join(plugin.root, 'commands')),
          hooks: isPresent(join(plugin.root, 'hooks', 'hooks.json')),
        });
      });

      return ExtensionDiscovery.of({ listPlugins, listServers, listSkills, readPluginFiles });
    })
  );
}
