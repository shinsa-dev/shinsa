import { execFile } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { app, dialog, autoUpdater as nativeUpdater } from 'electron';
import electronUpdater from 'electron-updater';
import type { UpdateChannel } from '../lib/bridge.ts';
import { APP_NAME } from '../lib/dev-bundle.ts';
import { APP_ID } from '../lib/engine.ts';
import {
  DOWNGRADE_ACCEPT,
  describeDowngradeDialog,
  describeInstallError,
  describeInstallFailure,
  describeManualResult,
  describeReadyNotice,
  describeUpdateFailure,
  describeUpdateItem,
  INSTALL_TIMEOUT_MS,
  isUpdateBusy,
  isUpdateSupported,
  needsDiscard,
  resolveDesktopUpdate,
  resolveInstallTimeout,
  resolvePreparedUpdate,
  resolveStagedUpdate,
  UPDATE_CHECK_MS,
  type UpdateState,
} from '../lib/update.ts';
import {
  resolveDowngradeOffer,
  resolveUpdateChannel,
  resolveUpdaterOptions,
  UPDATE_FEED,
} from '../lib/update-channel.ts';
import { describeStateChange } from '../lib/update-log.ts';
import { showNotice } from './notifications.ts';
import { readPrefs, writePrefs } from './prefs.ts';
import { createUpdateLog } from './update-log.ts';

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
  #log: ReturnType<typeof createUpdateLog> | null = null;

  constructor(changed: () => void, open: () => void, markQuitting: () => void) {
    this.#changed = changed;
    this.#open = open;
    if (!this.#supported) return;
    const log = createUpdateLog();
    this.#log = log;
    autoUpdater.logger = log;
    log.info(`${APP_NAME} ${app.getVersion()} on the ${this.#channel} channel`);
    nativeUpdater.on('before-quit-for-update', () => {
      log.info('Squirrel: quitting to install');
      markQuitting();
    });
    nativeUpdater.on('update-downloaded', () => {
      log.info('Squirrel: update staged');
      this.#ready();
    });
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
    autoUpdater.on('update-downloaded', (info) => this.#prepare(info.version));
    autoUpdater.on('error', (error) => this.#fail(describeUpdateFailure(error)));
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
    writePrefs({ updateChannel: channel, keptVersion: null });
    this.#changed();
    if (!this.#supported) return;
    this.#applyOptions();
    if (needsDiscard(this.#state, channel)) await this.#discard();
    this.#ask = true;
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
    if (!this.#supported || isUpdateBusy(this.#state)) return;
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
      writePrefs({ keptVersion: app.getVersion() });
      this.#set({ status: 'current', latest: this.#state.version });
      return;
    }
    writePrefs({ keptVersion: null });
    this.#applyOptions(true);
    try {
      await this.check(false);
    } finally {
      this.#applyOptions();
    }
  }

  install() {
    if (this.#state.status !== 'ready') return;
    const version = this.#state.version;
    this.#set({ status: 'installing', version });
    setTimeout(() => this.#installTimedOut(), INSTALL_TIMEOUT_MS);
    autoUpdater.quitAndInstall();
  }

  #installTimedOut() {
    const next = resolveInstallTimeout(this.#state);
    if (!next) return;
    this.#set(next);
    showNotice({ ...describeInstallFailure(next.version), tag: 'update', path: null }, () => this.#open());
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
    const kept = readPrefs().keptVersion;
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
      ...describeDowngradeDialog(version, app.getVersion(), this.#channel),
    });
    await this.answerDowngrade(answer.response === DOWNGRADE_ACCEPT);
  }

  #prepare(version: string) {
    this.#download = null;
    this.#set({ status: 'preparing', version });
  }

  #ready() {
    const next = resolvePreparedUpdate(this.#state);
    if (!next) return;
    this.#set(next);
    showNotice({ ...describeReadyNotice(next.version), tag: 'update', path: null }, () => this.#open());
  }

  #fail(message: string) {
    const notice = describeInstallError(this.#state, message);
    this.#settle({ status: 'failed', message });
    if (notice) showNotice({ ...notice, tag: 'update', path: null }, () => this.#open());
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
    autoUpdater.setFeedURL(UPDATE_FEED);
    autoUpdater.channel = options.channel;
    autoUpdater.allowPrerelease = options.allowPrerelease;
    autoUpdater.allowDowngrade = options.allowDowngrade;
  }

  #set(next: UpdateState) {
    const change = describeStateChange(this.#state, next);
    if (change) this.#log?.info(change);
    this.#state = next;
    this.#changed();
  }
}
