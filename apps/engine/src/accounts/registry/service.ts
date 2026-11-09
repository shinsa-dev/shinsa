import type { AccountUsage } from '@shinsa/core';
import { Context, Duration, Effect, Layer, Option, Schema } from 'effect';
import { JsonFile } from '../../files/service.ts';
import {
  CachedUsage,
  type Registry,
  RegistryFields,
  type SpentMark,
  SpentMark as SpentMarkSchema,
  SpentMarksFields,
  type StoredAccount,
  StoredAccountFields,
  UNKNOWN_RESET,
  UsageCacheFields,
} from '../schema.ts';

export class AccountRegistry extends Context.Service<
  AccountRegistry,
  {
    readAccounts(path: string): Effect.Effect<Registry>;
    writeAccounts(path: string, registry: Registry): Effect.Effect<void>;
    readUsage(path: string): Effect.Effect<Map<string, AccountUsage>>;
    keepUsage(path: string, entries: ReadonlyMap<string, AccountUsage>): Effect.Effect<void>;
    readMarks(path: string, now: number): Effect.Effect<Map<string, SpentMark>>;
    keepMarks(path: string, marks: ReadonlyMap<string, SpentMark>): Effect.Effect<void>;
  }
>()('shinsa/engine/accounts/registry/AccountRegistry') {
  static readonly layer = Layer.effect(
    AccountRegistry,
    Effect.gen(function* () {
      const files = yield* JsonFile;
      const decodeRegistry = Schema.decodeUnknownOption(RegistryFields);
      const decodeAccount = Schema.decodeUnknownOption(StoredAccountFields);
      const decodeUsage = Schema.decodeUnknownOption(UsageCacheFields);
      const isCachedUsage = Schema.is(CachedUsage);
      const decodeMarks = Schema.decodeUnknownOption(SpentMarksFields);
      const decodeMark = Schema.decodeUnknownOption(SpentMarkSchema);
      const unknownResetMs = Duration.toMillis(UNKNOWN_RESET);

      const readAccount = (value: unknown): StoredAccount[] =>
        Option.toArray(
          Option.map(decodeAccount(value), (fields) => ({
            id: fields.id,
            configDir: fields.configDir ?? null,
            email: fields.email ?? null,
            organization: fields.organization ?? null,
            plan: fields.plan ?? null,
            origin: fields.origin,
            owner: fields.owner ?? null,
            addedAt: fields.addedAt ?? 0,
            paused: fields.paused === true,
            switchAt: fields.switchAt === undefined ? null : Math.round(fields.switchAt),
          }))
        );

      const setAside = Effect.fn('AccountRegistry.setAside')(function* (path: string, reason: string) {
        const copy = yield* files.keepAside(path).pipe(Effect.orDie);
        yield* Effect.logWarning('[Accounts] The account list could not be read; starting with none').pipe(
          Effect.annotateLogs({ path, copy, error: reason })
        );
        return Option.none<unknown>();
      });

      const readAccounts = Effect.fn('AccountRegistry.readAccounts')(function* (path: string) {
        const stored = yield* files
          .read(path, Schema.Unknown)
          .pipe(Effect.catchTag('JsonFileUnreadable', (unreadable) => setAside(path, unreadable.reason)));
        const fields = Option.getOrUndefined(Option.flatMap(stored, decodeRegistry));
        const accounts = (fields?.accounts ?? []).flatMap(readAccount);
        const preferred = fields?.defaultAccountId;
        const defaultAccountId = accounts.some((account) => account.id === preferred)
          ? (preferred ?? null)
          : (accounts[0]?.id ?? null);
        return { version: 1, defaultAccountId, accounts } satisfies Registry;
      });

      const writeAccounts = Effect.fn('AccountRegistry.writeAccounts')(function* (
        path: string,
        registry: Registry
      ) {
        yield* files.write(path, registry).pipe(Effect.orDie);
      });

      const readUsage = Effect.fn('AccountRegistry.readUsage')(function* (path: string) {
        const stored = yield* files
          .read(path, Schema.Unknown)
          .pipe(
            Effect.catchTag('JsonFileUnreadable', (unreadable) =>
              Effect.as(
                Effect.logWarning('[Accounts] The usage cache could not be read; starting without it').pipe(
                  Effect.annotateLogs({ path, error: unreadable.reason })
                ),
                Option.none()
              )
            )
          );
        const accounts = Option.getOrUndefined(Option.flatMap(stored, decodeUsage))?.accounts ?? {};
        const entries = new Map<string, AccountUsage>();
        for (const [id, usage] of Object.entries(accounts)) {
          if (isCachedUsage(usage)) entries.set(id, { ...(usage as AccountUsage), source: 'cache' });
        }
        return entries;
      });

      const keepUsage = Effect.fn('AccountRegistry.keepUsage')(function* (
        path: string,
        entries: ReadonlyMap<string, AccountUsage>
      ) {
        yield* files
          .write(path, { version: 1, accounts: Object.fromEntries(entries) })
          .pipe(
            Effect.catchTag('JsonFileWriteFailed', (failed) =>
              Effect.logWarning('[Accounts] Could not keep the usage cache').pipe(
                Effect.annotateLogs({ error: failed.message })
              )
            )
          );
      });

      const readMarks = Effect.fn('AccountRegistry.readMarks')(function* (path: string, now: number) {
        const stored = yield* files
          .read(path, Schema.Unknown)
          .pipe(
            Effect.catchTag('JsonFileUnreadable', (unreadable) =>
              Effect.as(
                Effect.logWarning(
                  '[Accounts] The spent accounts could not be read; starting without them'
                ).pipe(Effect.annotateLogs({ path, error: unreadable.reason })),
                Option.none()
              )
            )
          );
        const marks = new Map<string, SpentMark>();
        const listed = Option.getOrUndefined(Option.flatMap(stored, decodeMarks))?.marks ?? {};
        for (const [accountId, value] of Object.entries(listed)) {
          for (const mark of Option.toArray(decodeMark(value))) {
            if ((mark.until ?? mark.at + unknownResetMs) > now) marks.set(accountId, mark);
          }
        }
        return marks;
      });

      const keepMarks = Effect.fn('AccountRegistry.keepMarks')(function* (
        path: string,
        marks: ReadonlyMap<string, SpentMark>
      ) {
        yield* files
          .write(path, { version: 1, marks: Object.fromEntries(marks) })
          .pipe(
            Effect.catchTag('JsonFileWriteFailed', (failed) =>
              Effect.logWarning('[Accounts] Could not keep the spent accounts').pipe(
                Effect.annotateLogs({ error: failed.message })
              )
            )
          );
      });

      return AccountRegistry.of({ readAccounts, writeAccounts, readUsage, keepUsage, readMarks, keepMarks });
    })
  );
}
