import { join } from 'node:path';
import type { ServiceDefinition, TerminalInfo } from '@shinsa/core';
import { Context, Effect, FileSystem, Layer, Option, Schema } from 'effect';
import { JsonFile } from '../../files/service.ts';
import { describeError } from '../../log/redact.ts';
import {
  SCREEN_MODE,
  SERVICES_FILE,
  StoredService,
  StoredServices,
  StoredTerminal,
  StoredTerminals,
  TERMINALS_DIR,
  TERMINALS_FILE,
} from '../schema.ts';

export class TerminalFiles extends Context.Service<
  TerminalFiles,
  {
    readTerminals(dataDir: string): Effect.Effect<TerminalInfo[]>;
    writeTerminals(dataDir: string, terminals: readonly TerminalInfo[]): Effect.Effect<void>;
    readServices(dataDir: string): Effect.Effect<ServiceDefinition[]>;
    writeServices(dataDir: string, services: readonly ServiceDefinition[]): Effect.Effect<void>;
    readScreen(dataDir: string, id: string): Effect.Effect<string | null>;
    writeScreen(dataDir: string, id: string, screen: string): Effect.Effect<void>;
    removeScreen(dataDir: string, id: string): Effect.Effect<void>;
  }
>()('shinsa/engine/terminals/store/TerminalFiles') {
  static readonly layer = Layer.effect(
    TerminalFiles,
    Effect.gen(function* () {
      const files = yield* JsonFile;
      const fs = yield* FileSystem.FileSystem;
      const decodeTerminal = Schema.decodeUnknownOption(StoredTerminal);
      const decodeService = Schema.decodeUnknownOption(StoredService);
      const decodeTerminals = Schema.decodeUnknownOption(StoredTerminals);
      const decodeServices = Schema.decodeUnknownOption(StoredServices);

      const resolveDir = (dataDir: string) => join(dataDir, TERMINALS_DIR);
      const resolveScreen = (dataDir: string, id: string) => join(resolveDir(dataDir), `${id}.screen`);

      const readList = Effect.fn('TerminalFiles.readList')(function* <A>(
        path: string,
        what: string,
        readItems: (value: unknown) => readonly unknown[],
        decodeItem: (value: unknown) => Option.Option<A>
      ) {
        const stored = yield* files.read(path, Schema.Unknown).pipe(
          Effect.map(Option.getOrNull),
          Effect.catchTag('JsonFileUnreadable', (unreadable) =>
            Effect.as(
              Effect.logWarning(`[Terminals] Could not read the saved ${what}`).pipe(
                Effect.annotateLogs({ error: unreadable.reason })
              ),
              null
            )
          )
        );
        return readItems(stored).flatMap((item) => Option.toArray(decodeItem(item)));
      });

      const readTerminals = Effect.fn('TerminalFiles.readTerminals')(function* (dataDir: string) {
        return yield* readList(
          join(resolveDir(dataDir), TERMINALS_FILE),
          'terminals',
          (value) =>
            Option.match(decodeTerminals(value), { onNone: () => [], onSome: (list) => list.terminals }),
          decodeTerminal
        );
      });

      const readServices = Effect.fn('TerminalFiles.readServices')(function* (dataDir: string) {
        return yield* readList(
          join(resolveDir(dataDir), SERVICES_FILE),
          'services',
          (value) =>
            Option.match(decodeServices(value), { onNone: () => [], onSome: (list) => list.services }),
          decodeService
        );
      });

      const writeTerminals = Effect.fn('TerminalFiles.writeTerminals')(function* (
        dataDir: string,
        terminals: readonly TerminalInfo[]
      ) {
        yield* files.write(join(resolveDir(dataDir), TERMINALS_FILE), { terminals }).pipe(Effect.orDie);
      });

      const writeServices = Effect.fn('TerminalFiles.writeServices')(function* (
        dataDir: string,
        services: readonly ServiceDefinition[]
      ) {
        yield* files.write(join(resolveDir(dataDir), SERVICES_FILE), { services }).pipe(Effect.orDie);
      });

      const readScreen = Effect.fn('TerminalFiles.readScreen')(function* (dataDir: string, id: string) {
        return yield* fs.readFileString(resolveScreen(dataDir, id)).pipe(Effect.orElseSucceed(() => null));
      });

      const writeScreen = Effect.fn('TerminalFiles.writeScreen')(function* (
        dataDir: string,
        id: string,
        screen: string
      ) {
        yield* fs.makeDirectory(resolveDir(dataDir), { recursive: true }).pipe(
          Effect.andThen(fs.writeFileString(resolveScreen(dataDir, id), screen, { mode: SCREEN_MODE })),
          Effect.catch((error) =>
            Effect.logWarning('[Terminals] Could not save a terminal’s screen').pipe(
              Effect.annotateLogs({ terminalId: id, error: describeError(error) })
            )
          )
        );
      });

      const removeScreen = Effect.fn('TerminalFiles.removeScreen')(function* (dataDir: string, id: string) {
        yield* fs
          .remove(resolveScreen(dataDir, id), { force: true })
          .pipe(
            Effect.catch((error) =>
              Effect.logWarning('[Terminals] Could not remove a terminal’s saved screen').pipe(
                Effect.annotateLogs({ terminalId: id, error: describeError(error) })
              )
            )
          );
      });

      return TerminalFiles.of({
        readTerminals,
        writeTerminals,
        readServices,
        writeServices,
        readScreen,
        writeScreen,
        removeScreen,
      });
    })
  );
}
