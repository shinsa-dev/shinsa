import { join } from 'node:path';
import { app, Menu, type MenuItemConstructorOptions, nativeImage, Tray } from 'electron';
import type { ServerHealth } from '../lib/health.ts';
import { describeTrayStatus, listTrayItems, type TrayAction, type TrayItem } from '../lib/tray.ts';

export class StatusTray {
  readonly #tray: Tray;
  readonly #onAction: (action: TrayAction) => void;
  #shown = '';

  constructor(onAction: (action: TrayAction) => void) {
    this.#onAction = onAction;
    const icon = nativeImage.createFromPath(join(app.getAppPath(), 'static', 'trayTemplate.png'));
    icon.setTemplateImage(true);
    this.#tray = new Tray(icon);
    this.update(null);
  }

  update(health: ServerHealth | null) {
    const status = describeTrayStatus(health);
    if (status === this.#shown) return;
    this.#shown = status;
    this.#tray.setToolTip(status);
    this.#tray.setContextMenu(
      Menu.buildFromTemplate(listTrayItems(health).map((item) => this.#toMenuItem(item)))
    );
  }

  #toMenuItem(item: TrayItem): MenuItemConstructorOptions {
    if (item.kind === 'separator') return { type: 'separator' };
    if (item.kind === 'status') return { label: item.label, enabled: false };
    return { label: item.label, sublabel: item.sublabel, click: () => this.#onAction(item.action) };
  }
}
