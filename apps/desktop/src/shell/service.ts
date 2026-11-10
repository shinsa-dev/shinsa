import { Context, type Effect, type Stream } from 'effect';
import type { MenuCommand, MenuSection } from '../menu/schema.ts';
import type { AboutPanel, ShellEvent, ShellGuards } from './schema.ts';

export class DesktopShell extends Context.Service<
  DesktopShell,
  {
    readonly events: Stream.Stream<ShellEvent>;
    guard(guards: ShellGuards): Effect.Effect<void>;
    readonly quit: Effect.Effect<void>;
    setBadge(text: string): Effect.Effect<void>;
    openExternal(url: string): Effect.Effect<void>;
    openPath(path: string): Effect.Effect<void>;
    writeClipboard(text: string): Effect.Effect<void>;
    setAboutPanel(panel: AboutPanel): Effect.Effect<void>;
    applyMenu(sections: readonly MenuSection[]): Effect.Effect<void>;
    readonly menuCommands: Stream.Stream<MenuCommand>;
  }
>()('shinsa/desktop/shell/DesktopShell') {}
