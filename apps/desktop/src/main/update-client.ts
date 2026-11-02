import { type Cause, Effect, Layer, Option, Queue, Stream } from 'effect';
import { autoUpdater as nativeUpdater } from 'electron';
import electronUpdater, { type ProgressInfo, type UpdateInfo } from 'electron-updater';
import { UpdateClient } from '../update-client/service.ts';
import type { LogLevel } from '../update-log/schema.ts';
import { UPDATE_FEED, UpdateCheckFailed, type UpdateEvent } from '../updates/schema.ts';
import { describeUpdateFailure } from '../updates/state.ts';

const { autoUpdater } = electronUpdater;

const events = Stream.callback<UpdateEvent>(
  Effect.fn('UpdateClient.events')(function* (queue: Queue.Queue<UpdateEvent, Cause.Done>) {
    const emit = (event: UpdateEvent) => {
      Queue.offerUnsafe(queue, event);
    };
    const log = (level: LogLevel) => (message: unknown) => emit({ _tag: 'Log', level, message });
    const onAvailable = (info: UpdateInfo) => emit({ _tag: 'Available', version: info.version });
    const onProgress = (progress: ProgressInfo) => emit({ _tag: 'Progress', percent: progress.percent });
    const onNotAvailable = (info: UpdateInfo) => emit({ _tag: 'NotAvailable', version: info.version });
    const onDownloaded = (info: UpdateInfo) => emit({ _tag: 'Downloaded', version: info.version });
    const onError = (error: Error) => emit({ _tag: 'Failed', message: describeUpdateFailure(error) });
    const onStaged = () => emit({ _tag: 'Staged' });
    const onQuitting = () => emit({ _tag: 'QuittingToInstall' });
    autoUpdater.logger = { debug: log('debug'), info: log('info'), warn: log('warn'), error: log('error') };
    nativeUpdater.on('before-quit-for-update', onQuitting);
    nativeUpdater.on('update-downloaded', onStaged);
    autoUpdater.on('update-available', onAvailable);
    autoUpdater.on('download-progress', onProgress);
    autoUpdater.on('update-not-available', onNotAvailable);
    autoUpdater.on('update-downloaded', onDownloaded);
    autoUpdater.on('error', onError);
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        autoUpdater.logger = null;
        nativeUpdater.off('before-quit-for-update', onQuitting);
        nativeUpdater.off('update-downloaded', onStaged);
        autoUpdater.off('update-available', onAvailable);
        autoUpdater.off('download-progress', onProgress);
        autoUpdater.off('update-not-available', onNotAvailable);
        autoUpdater.off('update-downloaded', onDownloaded);
        autoUpdater.off('error', onError);
      })
    );
  })
);

export const UpdateClientLive = Layer.succeed(
  UpdateClient,
  UpdateClient.of({
    events,
    configure: (options) =>
      Effect.sync(() => {
        autoUpdater.setFeedURL(UPDATE_FEED);
        autoUpdater.channel = options.channel;
        autoUpdater.allowPrerelease = options.allowPrerelease;
        autoUpdater.allowDowngrade = options.allowDowngrade;
        autoUpdater.autoDownload = true;
        autoUpdater.autoInstallOnAppQuit = true;
      }),
    check: Effect.tryPromise({
      try: () => autoUpdater.checkForUpdates(),
      catch: (error) => new UpdateCheckFailed({ message: describeUpdateFailure(error) }),
    }).pipe(
      Effect.map((result) => {
        const token = result?.cancellationToken;
        const done = result?.downloadPromise;
        if (!token || !done) return Option.none();
        return Option.some({
          cancel: Effect.sync(() => token.cancel()),
          done: Effect.ignore(Effect.tryPromise(() => done)),
        });
      })
    ),
    quitAndInstall: Effect.sync(() => autoUpdater.quitAndInstall()),
  })
);
