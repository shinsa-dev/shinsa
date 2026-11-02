import { createContextOptimizer } from '@shinsa/core';
import { Context, Effect, Layer, Option, Schema } from 'effect';
import { JsonFile } from '../../files/service.ts';
import { parseStoredDefinition } from '../definitions.ts';
import {
  ExtensionScope,
  ExtensionsFile,
  McpToolInfo,
  type ExtensionsSettings,
  StoredServerFields,
  type StoredServer,
  type UsageFile,
  UsageFileFields,
} from '../schema.ts';

export class ExtensionFiles extends Context.Service<
  ExtensionFiles,
  {
    readSettings(path: string): Effect.Effect<ExtensionsSettings>;
    writeSettings(path: string, settings: ExtensionsSettings): Effect.Effect<void>;
    readUsage(path: string | null): Effect.Effect<UsageFile>;
    writeUsage(path: string | null, usage: UsageFile): Effect.Effect<void>;
  }
>()('shinsa/engine/extensions/store/ExtensionFiles') {
  static readonly layer = Layer.effect(
    ExtensionFiles,
    Effect.gen(function* () {
      const files = yield* JsonFile;
      const decodeServer = Schema.decodeUnknownOption(StoredServerFields);
      const decodeScope = Schema.decodeUnknownOption(ExtensionScope);
      const decodeTool = Schema.decodeUnknownOption(McpToolInfo);
      const decodeSettings = Schema.decodeUnknownOption(ExtensionsFile);
      const decodeUsage = Schema.decodeUnknownOption(UsageFileFields);

      const readStoredServer = (value: unknown): StoredServer[] =>
        Option.toArray(
          Option.flatMapNullishOr(decodeServer(value), (fields) => {
            const definition = parseStoredDefinition(fields.definition);
            if (!definition) return null;
            return {
              id: fields.id,
              name: fields.name,
              definition,
              enabled: fields.enabled !== false,
              scope: Option.getOrNull(decodeScope(fields.scope)) ?? { kind: 'everywhere' },
            };
          })
        );

      const createSettings = (): ExtensionsSettings => ({
        version: 1,
        servers: [],
        choices: {},
        skills: {},
        plugins: {},
        statuses: {},
        optimizer: createContextOptimizer(),
        seen: {},
      });

      const readSettings = Effect.fn('ExtensionFiles.readSettings')(function* (path: string) {
        const stored = yield* files.read(path, Schema.Unknown).pipe(
          Effect.map(Option.flatMap(decodeSettings)),
          Effect.catchTag('JsonFileUnreadable', (unreadable) =>
            Effect.as(
              Effect.logWarning('[Extensions] extensions.json could not be read; starting from none').pipe(
                Effect.annotateLogs({ path, error: unreadable.reason })
              ),
              Option.none()
            )
          )
        );
        return Option.match(stored, {
          onNone: createSettings,
          onSome: (file): ExtensionsSettings => ({
            version: 1,
            servers: (file.servers ?? []).flatMap(readStoredServer),
            choices: file.choices ?? {},
            skills: file.skills ?? {},
            plugins: file.plugins ?? {},
            statuses: Object.fromEntries(
              Object.entries(file.statuses ?? {}).map(([id, status]) => [
                id,
                {
                  ...status,
                  tools: (status.tools ?? []).flatMap((tool) => Option.toArray(decodeTool(tool))),
                },
              ])
            ),
            optimizer: file.optimizer ?? createContextOptimizer(),
            seen: file.seen ?? {},
          }),
        });
      });

      const createUsage = (): UsageFile => ({
        version: 1,
        files: {},
        servers: {},
        labels: {},
        skills: {},
        readAt: null,
        since: null,
      });

      const readUsage = Effect.fn('ExtensionFiles.readUsage')(function* (path: string | null) {
        if (path === null) return createUsage();
        const stored = yield* files.read(path, Schema.Unknown).pipe(
          Effect.map(Option.flatMap(decodeUsage)),
          Effect.catchTag('JsonFileUnreadable', (unreadable) =>
            Effect.as(
              Effect.logWarning(
                '[Extensions] The usage cache could not be read; reading the sessions again'
              ).pipe(Effect.annotateLogs({ path, error: unreadable.reason })),
              Option.none()
            )
          )
        );
        return Option.match(stored, {
          onNone: createUsage,
          onSome: (file): UsageFile => ({
            version: 1,
            files: file.files ?? {},
            servers: file.servers ?? {},
            labels: file.labels ?? {},
            skills: file.skills ?? {},
            readAt: file.readAt,
            since: file.since,
          }),
        });
      });

      const writeSettings = Effect.fn('ExtensionFiles.writeSettings')(function* (
        path: string,
        settings: ExtensionsSettings
      ) {
        yield* files.write(path, settings).pipe(Effect.orDie);
      });

      const writeUsage = Effect.fn('ExtensionFiles.writeUsage')(function* (
        path: string | null,
        usage: UsageFile
      ) {
        if (path !== null) yield* files.write(path, usage).pipe(Effect.orDie);
      });

      return ExtensionFiles.of({ readSettings, writeSettings, readUsage, writeUsage });
    })
  );
}
