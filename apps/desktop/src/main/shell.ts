import { Effect, Layer, Queue, Stream } from 'effect';
import { app, clipboard, Menu, type MenuItemConstructorOptions, shell } from 'electron';
import type { MenuCommand, MenuEntry } from '../menu/schema.ts';
import type { ShellEvent, ShellGuards } from '../shell/schema.ts';
import { DesktopShell } from '../shell/service.ts';

export const DesktopShellLive = Layer.effect(
  DesktopShell,
  Effect.gen(function* () {
    const events = yield* Queue.unbounded<ShellEvent>();
    const commands = yield* Queue.unbounded<MenuCommand>();
    let guards: ShellGuards | null = null;
    const emit = (event: ShellEvent) => {
      Queue.offerUnsafe(events, event);
    };
    const onSecondInstance = (_event: Electron.Event, argv: string[]) =>
      emit({ _tag: 'SecondInstance', argv });
    const onOpenUrl = (event: Electron.Event, url: string) => {
      event.preventDefault();
      emit({ _tag: 'OpenUrl', url });
    };
    const onActivate = () => emit({ _tag: 'Activate' });
    const onBeforeQuit = () => {
      if (guards) Effect.runSync(guards.beforeQuit);
    };
    app.on('second-instance', onSecondInstance);
    app.on('open-url', onOpenUrl);
    app.on('activate', onActivate);
    app.on('before-quit', onBeforeQuit);
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        app.off('second-instance', onSecondInstance);
        app.off('open-url', onOpenUrl);
        app.off('activate', onActivate);
        app.off('before-quit', onBeforeQuit);
      })
    );
    const toMenuItem = (entry: MenuEntry): MenuItemConstructorOptions => {
      if (entry.kind === 'separator') return { type: 'separator' };
      if (entry.kind === 'role')
        return entry.label === undefined ? { role: entry.role } : { role: entry.role, label: entry.label };
      const { command, kind: _kind, ...item } = entry;
      return {
        ...item,
        click: () => {
          Queue.offerUnsafe(commands, command);
        },
      };
    };
    return DesktopShell.of({
      events: Stream.fromQueue(events),
      guard: (next) =>
        Effect.sync(() => {
          guards = next;
        }),
      quit: Effect.sync(() => app.quit()),
      setBadge: (text) => Effect.sync(() => app.dock?.setBadge(text)),
      openExternal: (url) => Effect.ignore(Effect.tryPromise(() => shell.openExternal(url))),
      openPath: (path) => Effect.ignore(Effect.tryPromise(() => shell.openPath(path))),
      writeClipboard: (text) => Effect.ignore(Effect.tryPromise(() => clipboard.writeText(text))),
      setAboutPanel: (panel) => Effect.sync(() => app.setAboutPanelOptions(panel)),
      applyMenu: (sections) =>
        Effect.sync(() =>
          Menu.setApplicationMenu(
            Menu.buildFromTemplate(
              sections.map((section) => ({
                label: section.label,
                ...(section.role ? { role: section.role } : {}),
                submenu: section.entries.map(toMenuItem),
              }))
            )
          )
        ),
      menuCommands: Stream.fromQueue(commands),
    });
  })
);
