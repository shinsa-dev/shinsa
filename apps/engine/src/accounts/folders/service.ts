import { join } from 'node:path';
import { Context, Effect, FileSystem, Layer, Option } from 'effect';
import { constFalse, constNull } from 'effect/Function';
import { JSON_FILE_MODE, JSON_INDENT } from '../../files/schema.ts';
import { JsonFile } from '../../files/service.ts';
import { describeError } from '../../log/redact.ts';
import { ACCOUNT_OWNED_ENTRIES, SEEDED_CONFIG_KEYS } from '../paths.ts';
import {
  ACCOUNT_CONFIG_FILE,
  ACCOUNT_DIR_MODE,
  type AccountFolderSources,
  CREDENTIALS_FILE,
  SharedEntryUnlinked,
  SharedGlobalConfig,
} from '../schema.ts';

export class AccountFolders extends Context.Service<
  AccountFolders,
  {
    prepare(configDir: string, sources: AccountFolderSources): Effect.Effect<void>;
    writeConfig(configDir: string, patch: Record<string, unknown>): Effect.Effect<void>;
    remove(configDir: string): Effect.Effect<void>;
    readCredentials(dir: string): Effect.Effect<string | null>;
  }
>()('shinsa/engine/accounts/folders/AccountFolders') {
  static readonly layer = Layer.effect(
    AccountFolders,
    Effect.gen(function* () {
      const files = yield* JsonFile;
      const fs = yield* FileSystem.FileSystem;
      const listEntries = (dir: string) => Effect.option(fs.readDirectory(dir));
      const exists = (path: string) => fs.lstat(path).pipe(Effect.as(true), Effect.orElseSucceed(constFalse));
      const isLink = (path: string) =>
        fs.lstat(path).pipe(
          Effect.map((info) => info.type === 'SymbolicLink'),
          Effect.orElseSucceed(constFalse)
        );

      const seed = Effect.fn('AccountFolders.seed')(function* (
        configDir: string,
        sharedGlobalConfig: string
      ) {
        const target = join(configDir, ACCOUNT_CONFIG_FILE);
        if (yield* exists(target)) return;
        const read = yield* Effect.result(files.read(sharedGlobalConfig, SharedGlobalConfig));
        const found = read._tag === 'Success' ? Option.getOrUndefined(read.success) : undefined;
        if (found === undefined) {
          const error =
            read._tag === 'Failure' ? read.failure.reason : `${sharedGlobalConfig} does not exist.`;
          yield* Effect.logInfo('[Accounts] No shared Claude settings to copy into a new account').pipe(
            Effect.annotateLogs({ error })
          );
        }
        const shared: Record<string, unknown> = found ?? {};
        const seeded: Record<string, unknown> = { hasCompletedOnboarding: true };
        for (const key of SEEDED_CONFIG_KEYS) if (shared[key] !== undefined) seeded[key] = shared[key];
        yield* fs
          .writeFileString(target, `${JSON.stringify(seeded, null, JSON_INDENT)}\n`, {
            mode: JSON_FILE_MODE,
            flag: 'wx',
          })
          .pipe(Effect.orDie);
      });

      const link = Effect.fn('AccountFolders.link')(function* (
        configDir: string,
        sharedDir: string,
        entry: string
      ) {
        const target = join(configDir, entry);
        if (ACCOUNT_OWNED_ENTRIES.has(entry) || (yield* exists(target))) return;
        yield* fs.symlink(join(sharedDir, entry), target).pipe(
          Effect.mapError((error) => new SharedEntryUnlinked({ entry, message: describeError(error) })),
          Effect.catchTag('SharedEntryUnlinked', (unlinked) =>
            Effect.logWarning('[Accounts] Could not share a Claude setting with an account').pipe(
              Effect.annotateLogs({ entry, error: unlinked.message })
            )
          )
        );
      });

      const prepare = Effect.fn('AccountFolders.prepare')(function* (
        configDir: string,
        sources: AccountFolderSources
      ) {
        if (!(yield* exists(configDir))) {
          yield* fs.makeDirectory(configDir, { recursive: true, mode: ACCOUNT_DIR_MODE }).pipe(Effect.orDie);
          yield* seed(configDir, sources.sharedGlobalConfig);
        }
        const entries = Option.getOrElse(yield* listEntries(sources.sharedDir), () => []);
        for (const entry of entries) yield* link(configDir, sources.sharedDir, entry);
      });

      const writeConfig = Effect.fn('AccountFolders.writeConfig')(function* (
        configDir: string,
        patch: Record<string, unknown>
      ) {
        const path = join(configDir, ACCOUNT_CONFIG_FILE);
        const current = yield* files.read(path, SharedGlobalConfig).pipe(
          Effect.map(Option.getOrElse(() => ({}))),
          Effect.orElseSucceed(() => ({}))
        );
        yield* files.write(path, { ...current, ...patch }).pipe(Effect.orDie);
      });

      const remove = Effect.fn('AccountFolders.remove')(function* (configDir: string) {
        const entries = yield* listEntries(configDir);
        if (Option.isNone(entries)) return;
        for (const entry of entries.value) {
          const path = join(configDir, entry);
          if (yield* isLink(path)) yield* fs.remove(path).pipe(Effect.orDie);
        }
        yield* fs.remove(configDir, { recursive: true, force: true }).pipe(Effect.orDie);
      });

      const readCredentials = (dir: string) =>
        fs.readFileString(join(dir, CREDENTIALS_FILE)).pipe(Effect.orElseSucceed(constNull));

      return AccountFolders.of({ prepare, writeConfig, remove, readCredentials });
    })
  );
}
