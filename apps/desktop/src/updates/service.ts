import type { AppUpdateChannel } from '@shinsa/core/engine-api/schema';
import { Context, Effect, Layer, Option, Ref, Stream, SubscriptionRef } from 'effect';
import { APP_NAME } from '../app/schema.ts';
import { Dialogs } from '../dialogs/service.ts';
import { APP_ID } from '../engine/schema.ts';
import { Files } from '../files/service.ts';
import { DesktopHost } from '../host/service.ts';
import { Launchctl } from '../launchctl/service.ts';
import { Notifications } from '../notifications/service.ts';
import { Prefs } from '../prefs/service.ts';
import { UpdateClient } from '../update-client/service.ts';
import { UpdateLog } from '../update-log/service.ts';
import { AppWindow } from '../window/service.ts';
import { resolveDowngradeOffer, resolveUpdateChannel, resolveUpdaterOptions } from './channel.ts';
import {
  type Download,
  DOWNGRADE_ACCEPT,
  INSTALL_TIMEOUT,
  QUITTING_LOG,
  STAGED_LOG,
  UPDATE_CHECK_SCHEDULE,
  type UpdateEvent,
  type UpdateNotice,
  type UpdateSnapshot,
  type UpdateState,
} from './schema.ts';
import {
  describeDowngradeDialog,
  describeInstallError,
  describeInstallFailure,
  describeManualResult,
  describeReadyNotice,
  describeStateChange,
  isUpdateBusy,
  isUpdateSupported,
  needsDiscard,
  resolveInstallTimeout,
  resolvePreparedUpdate,
  resolveStagedUpdate,
} from './state.ts';

export class Updater extends Context.Service<
  Updater,
  {
    readonly snapshot: Effect.Effect<UpdateSnapshot>;
    readonly changes: Stream.Stream<UpdateSnapshot>;
    readonly start: Effect.Effect<void>;
    check(manual: boolean): Effect.Effect<void>;
    applyChannel(channel: AppUpdateChannel): Effect.Effect<void>;
    answerDowngrade(accept: boolean): Effect.Effect<void>;
    readonly install: Effect.Effect<void>;
  }
>()('shinsa/desktop/updates/Updater') {
  static readonly layer = Layer.effect(
    Updater,
    Effect.gen(function* () {
      const host = yield* DesktopHost;
      const files = yield* Files;
      const launchctl = yield* Launchctl;
      const prefs = yield* Prefs;
      const client = yield* UpdateClient;
      const log = yield* UpdateLog;
      const dialogs = yield* Dialogs;
      const notifications = yield* Notifications;
      const window = yield* AppWindow;
      const scope = yield* Effect.scope;
      const supported = isUpdateSupported({ packaged: host.packaged, platform: host.platform });
      const stored = yield* prefs.read;
      const snapshot = yield* SubscriptionRef.make<UpdateSnapshot>({
        state: { status: 'idle' },
        channel: resolveUpdateChannel(stored.updateChannel, host.version),
        supported,
      });
      const download = yield* Ref.make(Option.none<Download>());
      const ask = yield* Ref.make(false);
      const readState = Effect.map(SubscriptionRef.get(snapshot), (current) => current.state);
      const readChannel = Effect.map(SubscriptionRef.get(snapshot), (current) => current.channel);
      const isManual = Effect.map(readState, (state) => state.status === 'checking' && state.manual);
      const inBackground = (effect: Effect.Effect<void>) => Effect.asVoid(Effect.forkIn(effect, scope));
      const notify = (notice: UpdateNotice) => notifications.show({ ...notice, tag: 'update', path: null });
      const configure = (downgrade: boolean) =>
        Effect.flatMap(readChannel, (channel) => client.configure(resolveUpdaterOptions(channel, downgrade)));
      const set = Effect.fn('Updater.set')(function* (next: UpdateState) {
        const previous = yield* readState;
        const change = describeStateChange(previous, next);
        if (change) yield* log.write('info', change);
        yield* SubscriptionRef.update(snapshot, (current) => ({ ...current, state: next }));
      });
      const settle = Effect.fn('Updater.settle')(function* (next: UpdateState) {
        const manual = yield* isManual;
        yield* Ref.set(ask, false);
        yield* set(next);
        if (!manual) return;
        const result = describeManualResult(next, host.version, yield* readChannel);
        if (!result) return;
        yield* inBackground(
          Effect.asVoid(dialogs.show({ type: next.status === 'failed' ? 'warning' : 'info', ...result }))
        );
      });
      const check = Effect.fn('Updater.check')(function* (manual: boolean) {
        if (!supported || isUpdateBusy(yield* readState)) return;
        yield* set({ status: 'checking', manual });
        const started = yield* Effect.result(client.check);
        if (started._tag === 'Failure') {
          yield* settle({ status: 'failed', message: started.failure.message });
          return;
        }
        if (Option.isSome(started.success)) yield* Ref.set(download, started.success);
      });
      const answerDowngrade = Effect.fn('Updater.answerDowngrade')(function* (accept: boolean) {
        const state = yield* readState;
        if (state.status !== 'downgrade') return;
        if (!accept) {
          yield* prefs.write({ keptVersion: host.version });
          yield* set({ status: 'current', latest: state.version });
          return;
        }
        yield* prefs.write({ keptVersion: null });
        yield* configure(true);
        yield* check(false).pipe(Effect.ensuring(configure(false)));
      });
      const askDowngrade = Effect.fn('Updater.askDowngrade')(function* (version: string) {
        const response = yield* dialogs.show({
          type: 'question',
          ...describeDowngradeDialog(version, host.version, yield* readChannel),
        });
        yield* answerDowngrade(response === DOWNGRADE_ACCEPT);
      });
      const showCurrent = Effect.fn('Updater.showCurrent')(function* (latest: string) {
        const manual = yield* isManual;
        const asked = manual || (yield* Ref.get(ask));
        const kept = (yield* prefs.read).keptVersion;
        const version = resolveDowngradeOffer({
          channel: yield* readChannel,
          current: host.version,
          latest,
          kept: !manual && typeof kept === 'string' ? kept : null,
        });
        if (!version) {
          yield* settle({ status: 'current', latest });
          return;
        }
        yield* Ref.set(ask, false);
        yield* set({ status: 'downgrade', version });
        if (asked) yield* inBackground(askDowngrade(version));
      });
      const showReady = Effect.gen(function* () {
        const next = resolvePreparedUpdate(yield* readState);
        if (!next) return;
        yield* set(next);
        yield* notify(describeReadyNotice(next.version));
      });
      const fail = Effect.fn('Updater.fail')(function* (message: string) {
        const notice = describeInstallError(yield* readState, message);
        yield* settle({ status: 'failed', message });
        if (notice) yield* notify(notice);
      });
      const handle = Effect.fn('Updater.handle')(function* (event: UpdateEvent) {
        switch (event._tag) {
          case 'Available':
            yield* Ref.set(ask, false);
            return yield* set({ status: 'downloading', version: event.version, percent: 0 });
          case 'Progress': {
            const state = yield* readState;
            if (state.status === 'downloading') yield* set({ ...state, percent: event.percent });
            return;
          }
          case 'NotAvailable':
            return yield* showCurrent(event.version);
          case 'Downloaded':
            yield* Ref.set(download, Option.none());
            return yield* set({ status: 'preparing', version: event.version });
          case 'Failed':
            return yield* fail(event.message);
          case 'Staged':
            yield* log.write('info', STAGED_LOG);
            return yield* showReady;
          case 'QuittingToInstall':
            yield* log.write('info', QUITTING_LOG);
            return yield* window.markQuitting;
          case 'Log':
            return yield* log.write(event.level, event.message);
        }
      });
      const discard = Effect.gen(function* () {
        const current = yield* Ref.getAndSet(download, Option.none());
        if (Option.isSome(current)) {
          yield* current.value.cancel;
          yield* current.value.done;
        }
        const staged = resolveStagedUpdate(host.home, APP_ID);
        yield* launchctl.run(['remove', staged.label]);
        yield* files.remove(staged.directory);
        yield* set({ status: 'idle' });
      });
      const applyChannel = Effect.fn('Updater.applyChannel')(function* (channel: AppUpdateChannel) {
        if (channel === (yield* readChannel)) return;
        yield* SubscriptionRef.update(snapshot, (current) => ({ ...current, channel }));
        yield* prefs.write({ updateChannel: channel, keptVersion: null });
        if (!supported) return;
        yield* configure(false);
        if (needsDiscard(yield* readState, channel)) yield* discard;
        yield* Ref.set(ask, true);
        yield* check(false);
      });
      const timeOutInstall = Effect.gen(function* () {
        const next = resolveInstallTimeout(yield* readState);
        if (!next) return;
        yield* set(next);
        yield* notify(describeInstallFailure(next.version));
      });
      const install = Effect.gen(function* () {
        const state = yield* readState;
        if (state.status !== 'ready') return;
        yield* set({ status: 'installing', version: state.version });
        yield* inBackground(Effect.delay(timeOutInstall, INSTALL_TIMEOUT));
        yield* window.markQuitting;
        yield* client.quitAndInstall;
      });
      const start = Effect.gen(function* () {
        if (!supported) return;
        yield* log.rotate;
        yield* log.write('info', `${APP_NAME} ${host.version} on the ${yield* readChannel} channel`);
        yield* configure(false);
        yield* Effect.forkIn(Stream.runForEach(client.events, handle), scope, { startImmediately: true });
        yield* inBackground(Effect.repeat(check(false), UPDATE_CHECK_SCHEDULE));
      });
      return Updater.of({
        snapshot: SubscriptionRef.get(snapshot),
        changes: SubscriptionRef.changes(snapshot),
        start: start.pipe(Effect.withSpan('Updater.start')),
        check,
        applyChannel,
        answerDowngrade,
        install: install.pipe(Effect.withSpan('Updater.install')),
      });
    })
  );
}
