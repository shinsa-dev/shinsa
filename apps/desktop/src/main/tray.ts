import { join } from 'node:path';
import { app, Menu, type MenuItemConstructorOptions, nativeImage, Tray } from 'electron';
import type { ServerHealth } from '../lib/health.ts';
import {
  describeTrayStatus,
  listTrayItems,
  resolveTrayTitle,
  type TrayAction,
  type TrayItem,
  type TrayQueue,
} from '../lib/tray.ts';

export class StatusTray {
  readonly #tray: Tray;
  readonly #onAction: (action: TrayAction) => void;
  readonly #onOpen: (path: string) => void;
  #shown = '';

  constructor(onAction: (action: TrayAction) => void, onOpen: (path: string) => void) {
    this.#onAction = onAction;
    this.#onOpen = onOpen;
    const icon = nativeImage.createFromPath(join(app.getAppPath(), 'static', 'trayTemplate.png'));
    icon.setTemplateImage(true);
    this.#tray = new Tray(icon);
    this.update(null, null);
  }

  update(health: ServerHealth | null, queue: TrayQueue | null) {
    const items = listTrayItems(health, queue);
    const tasks = health ? queue : null;
    const title = resolveTrayTitle(tasks);
    const shown = JSON.stringify({ items, title });
    if (shown === this.#shown) return;
    this.#shown = shown;
    this.#tray.setTitle(title, { fontType: 'monospacedDigit' });
    this.#tray.setToolTip(describeTrayStatus(health, tasks));
    this.#tray.setContextMenu(Menu.buildFromTemplate(items.map((item) => this.#toMenuItem(item))));
  }

  #toMenuItem(item: TrayItem): MenuItemConstructorOptions {
    if (item.kind === 'separator') return { type: 'separator' };
    if (item.kind === 'header') return { type: 'header', label: item.label };
    if (item.kind === 'status') return { label: item.label, enabled: false };
    if (item.kind === 'task') {
      return { label: item.label, sublabel: item.sublabel, click: () => this.#onOpen(item.path) };
    }
    return { label: item.label, sublabel: item.sublabel, click: () => this.#onAction(item.action) };
  }
}
