import { execFile } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { app, dialog } from 'electron';
import electronUpdater from 'electron-updater';
import type { UpdateChannel } from '../lib/bridge.ts';
import { APP_ID } from '../lib/engine.ts';
import {
  DOWNGRADE_ACCEPT,
  describeDowngradeDialog,
  describeManualResult,
  describeReadyNotice,
  describeUpdateFailure,
  describeUpdateItem,
  isUpdateSupported,
  needsDiscard,
  resolveDesktopUpdate,
  resolveStagedUpdate,
  UPDATE_CHECK_MS,
  type UpdateState,
} from '../lib/update.ts';
import { resolveDowngradeOffer, resolveUpdateChannel, resolveUpdaterOptions } from '../lib/update-channel.ts';
import { showNotice } from './notifications.ts';
import { readPrefs, writePrefs } from './prefs.ts';

const { autoUpdater } = electronUpdater;

interface Download {
  cancel: () => void;
  done: Promise<unknown>;
}

export class Updater {
  #state: UpdateState = { status: 'idle' };
  readonly #changed: () => void;
  readonly #open: () => void;
  readonly #supported = isUpdateSupported({ packaged: app.isPackaged, platform: process.platform });
  #channel: UpdateChannel = resolveUpdateChannel(readPrefs().updateChannel, app.getVersion());
  #download: Download | null = null;
  #ask = false;

  constructor(changed: () => void, open: () => void) {
    this.#changed = changed;
    this.#open = open;
    if (!this.#supported) return;
    this.#applyOptions();
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on('update-available', (info) => {
      this.#ask = false;
      this.#set({ status: 'downloading', version: info.version, percent: 0 });
    });
    autoUpdater.on('download-progress', (progress) => {
      if (this.#state.status === 'downloading') this.#set({ ...this.#state, percent: progress.percent });
    });
    autoUpdater.on('update-not-available', (info) => this.#current(info.version));
    autoUpdater.on('update-downloaded', (info) => this.#ready(info.version));
    autoUpdater.on('error', (error) =>
      this.#settle({ status: 'failed', message: describeUpdateFailure(error) })
    );
  }

  get pageState() {
    return resolveDesktopUpdate(this.#state);
  }

  get channel() {
    return this.#channel;
  }

  async applyChannel(channel: UpdateChannel) {
    if (channel === this.#channel) return;
    this.#channel = channel;
    writePrefs({ updateChannel: channel, keptBeta: null });
    this.#changed();
    if (!this.#supported) return;
    this.#applyOptions();
    if (needsDiscard(this.#state, channel)) await this.#discard();
    this.#ask = channel === 'stable';
    await this.check(false);
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
    try {
      const result = await autoUpdater.checkForUpdates();
      const token = result?.cancellationToken;
      const done = result?.downloadPromise;
      if (token && done) this.#download = { cancel: () => token.cancel(), done: done.catch(() => null) };
    } catch (error) {
      this.#settle({ status: 'failed', message: describeUpdateFailure(error) });
    }
  }

  async answerDowngrade(accept: boolean) {
    if (this.#state.status !== 'downgrade') return;
    if (!accept) {
      writePrefs({ keptBeta: app.getVersion() });
      this.#set({ status: 'current', latest: this.#state.version });
      return;
    }
    writePrefs({ keptBeta: null });
    this.#applyOptions(true);
    try {
      await this.check(false);
    } finally {
      this.#applyOptions();
    }
  }

  install() {
    if (this.#state.status === 'ready') autoUpdater.quitAndInstall();
  }

  async #discard() {
    const download = this.#download;
    this.#download = null;
    download?.cancel();
    await download?.done;
    const staged = resolveStagedUpdate(homedir(), APP_ID);
    await new Promise((resolve) => execFile('launchctl', ['remove', staged.label], resolve));
    await rm(staged.directory, { recursive: true, force: true });
    this.#set({ status: 'idle' });
  }

  #current(latest: string) {
    const manual = this.#state.status === 'checking' && this.#state.manual;
    const ask = manual || this.#ask;
    const kept = readPrefs().keptBeta;
    const version = resolveDowngradeOffer({
      channel: this.#channel,
      current: app.getVersion(),
      latest,
      kept: !manual && typeof kept === 'string' ? kept : null,
    });
    if (!version) return this.#settle({ status: 'current', latest });
    this.#ask = false;
    this.#set({ status: 'downgrade', version });
    if (ask) void this.#askDowngrade(version);
  }

  async #askDowngrade(version: string) {
    const answer = await dialog.showMessageBox({
      type: 'question',
      ...describeDowngradeDialog(version, app.getVersion()),
    });
    await this.answerDowngrade(answer.response === DOWNGRADE_ACCEPT);
  }

  #ready(version: string) {
    this.#download = null;
    this.#set({ status: 'ready', version });
    showNotice({ ...describeReadyNotice(version), tag: 'update', path: null }, () => this.#open());
  }

  #settle(next: UpdateState) {
    const manual = this.#state.status === 'checking' && this.#state.manual;
    this.#ask = false;
    this.#set(next);
    const result = manual ? describeManualResult(next, app.getVersion(), this.#channel) : null;
    if (result)
      void dialog.showMessageBox({ type: next.status === 'failed' ? 'warning' : 'info', ...result });
  }

  #applyOptions(downgrade = false) {
    const options = resolveUpdaterOptions(this.#channel, downgrade);
    autoUpdater.channel = options.channel;
    autoUpdater.allowPrerelease = options.allowPrerelease;
    autoUpdater.allowDowngrade = options.allowDowngrade;
  }

  #set(next: UpdateState) {
    this.#state = next;
    this.#changed();
  }
}
