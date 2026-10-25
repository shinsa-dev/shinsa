import { app, dialog } from 'electron';
import electronUpdater from 'electron-updater';
import {
  describeManualResult,
  describeReadyNotice,
  describeUpdateFailure,
  describeUpdateItem,
  isUpdateSupported,
  resolveDesktopUpdate,
  UPDATE_CHECK_MS,
  type UpdateState,
} from '../lib/update.ts';
import { showNotice } from './notifications.ts';

const { autoUpdater } = electronUpdater;

export class Updater {
  #state: UpdateState = { status: 'idle' };
  readonly #changed: () => void;
  readonly #open: () => void;
  readonly #supported = isUpdateSupported({ packaged: app.isPackaged, platform: process.platform });

  constructor(changed: () => void, open: () => void) {
    this.#changed = changed;
    this.#open = open;
    if (!this.#supported) return;
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on('update-available', (info) =>
      this.#set({ status: 'downloading', version: info.version, percent: 0 })
    );
    autoUpdater.on('download-progress', (progress) => {
      if (this.#state.status === 'downloading') this.#set({ ...this.#state, percent: progress.percent });
    });
    autoUpdater.on('update-not-available', () => this.#settle({ status: 'current' }));
    autoUpdater.on('update-downloaded', (info) => this.#ready(info.version));
    autoUpdater.on('error', (error) =>
      this.#settle({ status: 'failed', message: describeUpdateFailure(error) })
    );
  }

  get pageState() {
    return resolveDesktopUpdate(this.#state);
  }

  get menuItem() {
    const item = describeUpdateItem(this.#state);
    return {
      ...item,
      visible: this.#supported,
      click: () => (item.install ? this.install() : this.check(true)),
    };
  }

  start() {
    if (!this.#supported) return;
    void this.check(false);
    setInterval(() => void this.check(false), UPDATE_CHECK_MS);
  }

  async check(manual: boolean) {
    if (!this.#supported || this.#state.status === 'downloading' || this.#state.status === 'ready') return;
    this.#set({ status: 'checking', manual });
    await autoUpdater.checkForUpdates().catch((error: unknown) => {
      this.#settle({ status: 'failed', message: describeUpdateFailure(error) });
    });
  }

  install() {
    if (this.#state.status === 'ready') autoUpdater.quitAndInstall();
  }

  #ready(version: string) {
    this.#set({ status: 'ready', version });
    showNotice({ ...describeReadyNotice(version), tag: 'update', path: null }, () => this.#open());
  }

  #settle(next: UpdateState) {
    const manual = this.#state.status === 'checking' && this.#state.manual;
    this.#set(next);
    const result = manual ? describeManualResult(next, app.getVersion()) : null;
    if (result)
      void dialog.showMessageBox({ type: next.status === 'failed' ? 'warning' : 'info', ...result });
  }

  #set(next: UpdateState) {
    this.#state = next;
    this.#changed();
  }
}
