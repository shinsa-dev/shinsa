import { join } from 'node:path';
import { Effect, Layer, Queue, Stream } from 'effect';
import { app, Menu, type MenuItemConstructorOptions, nativeImage, Tray } from 'electron';
import { NativeTray } from '../native-tray/service.ts';
import type { TrayClick, TrayItem } from '../tray/schema.ts';

export const NativeTrayLive = Layer.effect(
  NativeTray,
  Effect.gen(function* () {
    const clicks = yield* Queue.unbounded<TrayClick>();
    const click = (value: TrayClick) => () => {
      Queue.offerUnsafe(clicks, value);
    };
    const toMenuItem = (item: TrayItem): MenuItemConstructorOptions => {
      if (item.kind === 'separator') return { type: 'separator' };
      if (item.kind === 'header') return { type: 'header', label: item.label };
      if (item.kind === 'status') return { label: item.label, enabled: false };
      if (item.kind === 'task') {
        return {
          label: item.label,
          sublabel: item.sublabel,
          click: click({ kind: 'task', path: item.path }),
        };
      }
      return {
        label: item.label,
        sublabel: item.sublabel,
        click: click({ kind: 'action', action: item.action }),
      };
    };
    const icon = nativeImage.createFromPath(join(app.getAppPath(), 'static', 'trayTemplate.png'));
    icon.setTemplateImage(true);
    const tray = yield* Effect.acquireRelease(
      Effect.sync(() => new Tray(icon)),
      (opened) => Effect.sync(() => opened.destroy())
    );
    return NativeTray.of({
      show: (view) =>
        Effect.sync(() => {
          tray.setTitle(view.title, { fontType: 'monospacedDigit' });
          tray.setToolTip(view.tooltip);
          tray.setContextMenu(Menu.buildFromTemplate(view.items.map(toMenuItem)));
        }),
      clicks: Stream.fromQueue(clicks),
    });
  })
);
