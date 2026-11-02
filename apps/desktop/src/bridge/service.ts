import { ENGINE_PROTOCOL } from '@shinsa/core';
import { Effect, Layer, Option, Schema, Stream } from 'effect';
import { APP_ID } from '../engine/schema.ts';
import { DesktopHost } from '../host/service.ts';
import { resolveBadgeText, resolveNotificationSettingsUrl } from '../notifications/notice.ts';
import { Notifications } from '../notifications/service.ts';
import { PageRequest, type PageMessage } from '../page-channel/schema.ts';
import { PageChannel } from '../page-channel/service.ts';
import { DesktopShell } from '../shell/service.ts';
import { Updater } from '../updates/service.ts';
import { resolveDesktopUpdate } from '../updates/state.ts';
import { AppWindow } from '../window/service.ts';
import { CHANNELS, type DesktopStart } from './schema.ts';

export const PageBridge = Layer.effectDiscard(
  Effect.gen(function* () {
    const host = yield* DesktopHost;
    const channel = yield* PageChannel;
    const window = yield* AppWindow;
    const updater = yield* Updater;
    const notifications = yield* Notifications;
    const shell = yield* DesktopShell;
    const decodeRequest = Schema.decodeUnknownOption(PageRequest);
    const answer = Effect.fn('PageBridge.answer')(function* (message: PageMessage) {
      if (!window.isAppSender(message.frame)) return;
      const decoded = decodeRequest(message);
      if (Option.isNone(decoded)) return;
      const request = decoded.value;
      switch (request.channel) {
        case CHANNELS.installUpdate:
          return yield* updater.install;
        case CHANNELS.checkForUpdates:
          return yield* updater.check(true);
        case CHANNELS.updateChannel:
          return yield* updater.applyChannel(request.payload);
        case CHANNELS.downgrade:
          return yield* updater.answerDowngrade(request.payload);
        case CHANNELS.badge:
          return yield* shell.setBadge(resolveBadgeText(request.payload));
        case CHANNELS.notify:
          return yield* notifications.show(request.payload);
        case CHANNELS.notificationSettings:
          return yield* shell.openExternal(resolveNotificationSettingsUrl(APP_ID));
      }
    });
    const start = Effect.gen(function* () {
      const snapshot = yield* updater.snapshot;
      const started: DesktopStart = {
        version: host.version,
        protocol: ENGINE_PROTOCOL,
        update: resolveDesktopUpdate(snapshot.state),
        channel: snapshot.channel,
        windowState: yield* window.windowState,
      };
      return started;
    });
    yield* channel.serveStart((frame) => (window.ownsSender(frame) ? start : Effect.succeed(null)));
    yield* Effect.forkScoped(Stream.runForEach(channel.messages, answer), { startImmediately: true });
    yield* Effect.forkScoped(
      Stream.runForEach(Stream.drop(updater.changes, 1), (snapshot) =>
        window.sendToPage(CHANNELS.update, resolveDesktopUpdate(snapshot.state))
      ),
      { startImmediately: true }
    );
  })
);
