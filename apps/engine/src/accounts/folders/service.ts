import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { Context, Effect, Layer, Option } from 'effect';
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
      const readText = Option.liftThrowable((path: string) => readFileSync(path, 'utf8'));
      const listEntries = Option.liftThrowable((dir: string) => readdirSync(dir));
      const isLink = (path: string) =>
        Option.getOrElse(Option.liftThrowable(() => lstatSync(path).isSymbolicLink())(), () => false);
      const exists = (path: string) => Option.isSome(Option.liftThrowable(() => lstatSync(path))());

      const seed = Effect.fn('AccountFolders.seed')(function* (
        configDir: string,
        sharedGlobalConfig: string
      ) {
        const target = join(configDir, ACCOUNT_CONFIG_FILE);
        if (existsSync(target)) return;
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
        yield* Effect.sync(() =>
          writeFileSync(target, `${JSON.stringify(seeded, null, JSON_INDENT)}\n`, {
            mode: JSON_FILE_MODE,
            flag: 'wx',
          })
        );
      });

      const link = Effect.fn('AccountFolders.link')(function* (
        configDir: string,
        sharedDir: string,
        entry: string
      ) {
        const target = join(configDir, entry);
        if (ACCOUNT_OWNED_ENTRIES.has(entry) || exists(target)) return;
        yield* Effect.try({
          try: () => symlinkSync(join(sharedDir, entry), target),
          catch: (error) => new SharedEntryUnlinked({ entry, message: describeError(error) }),
        }).pipe(
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
        if (!existsSync(configDir)) {
          yield* Effect.sync(() => mkdirSync(configDir, { recursive: true, mode: ACCOUNT_DIR_MODE }));
          yield* seed(configDir, sources.sharedGlobalConfig);
        }
        const entries = Option.getOrElse(listEntries(sources.sharedDir), () => []);
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
        const entries = listEntries(configDir);
        if (Option.isNone(entries)) return;
        yield* Effect.sync(() => {
          for (const entry of entries.value) {
            const path = join(configDir, entry);
            if (isLink(path)) unlinkSync(path);
          }
          rmSync(configDir, { recursive: true, force: true });
        });
      });

      const readCredentials = (dir: string) =>
        Effect.sync(() => Option.getOrNull(readText(join(dir, CREDENTIALS_FILE))));

      return AccountFolders.of({ prepare, writeConfig, remove, readCredentials });
    })
  );
}
