import { Effect, Layer } from 'effect';
import { Notifications } from '../notifications/service.ts';
import { AppWindow } from '../window/service.ts';
import { showNotice } from './notifications.ts';
import { openWindows } from './open-windows.ts';

export const AppWindowLive = Layer.succeed(
  AppWindow,
  AppWindow.of({
    show: Effect.sync(() => openWindows.main?.show()),
    markQuitting: Effect.sync(() => openWindows.main?.markQuitting()),
  })
);

export const NotificationsLive = Layer.succeed(
  Notifications,
  Notifications.of({
    show: (notice) =>
      Effect.sync(() =>
        showNotice(notice, (path) => {
          if (path) openWindows.main?.open(path);
          openWindows.main?.show();
        })
      ),
  })
);
