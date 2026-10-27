import { isQuietSurface, type ShinsaBuild, type Surface } from '@shinsa/core';
import { createContext } from 'react';
import { createSignal } from '@/lib/signal.ts';

type DesktopWindowState = 'window' | 'fullscreen';

export const HOME_SHORTCUT = '⇧⌘H';

export interface DesktopNotice {
  title: string;
  body: string;
  tag: string;
  path: string | null;
}

export type UpdateChannel = 'stable' | 'beta';

export type DesktopUpdate =
  | { status: 'none' }
  | { status: 'checking' }
  | { status: 'current' }
  | { status: 'failed'; message: string }
  | { status: 'downloading'; version: string }
  | { status: 'ready'; version: string }
  | { status: 'downgrade'; version: string }
  | { status: 'unavailable' };

export interface DesktopBridge {
  version: string;
  protocol: number;
  update: DesktopUpdate;
  channel: UpdateChannel;
  windowState: DesktopWindowState;
  updateBadge: (count: number) => void;
  notify: (notice: DesktopNotice) => void;
  installUpdate: () => void;
  checkForUpdates: () => void;
  applyUpdateChannel: (channel: UpdateChannel) => void;
  answerDowngrade: (accept: boolean) => void;
  onNavigate: (listener: (path: string) => void) => () => void;
  onWindowState: (listener: (state: DesktopWindowState) => void) => () => void;
  onUpdate: (listener: (update: DesktopUpdate) => void) => () => void;
}

declare global {
  interface Window {
    shinsaDesktop?: DesktopBridge;
  }
}

function selectDesktop() {
  return window.shinsaDesktop ?? null;
}

export function isDesktop() {
  return selectDesktop() !== null;
}

export const DesktopChrome = createContext(false);

export function resolveSurface(): Surface {
  return isDesktop() ? 'desktop' : 'browser';
}

export function isPageQuiet(desktopConnected: boolean) {
  return isQuietSurface(resolveSurface(), desktopConnected);
}

export function applyDesktop(navigate: (path: string) => void) {
  const desktop = selectDesktop();
  if (!desktop) return () => undefined;
  const root = document.documentElement;
  root.dataset.desktop = desktop.windowState;
  const stopNavigate = desktop.onNavigate(navigate);
  const stopWindowState = desktop.onWindowState((state) => {
    root.dataset.desktop = state;
  });
  return () => {
    stopNavigate();
    stopWindowState();
    delete root.dataset.desktop;
  };
}

export function updateDesktopBadge(count: number) {
  selectDesktop()?.updateBadge(count);
}

export function notifyDesktop(notice: DesktopNotice) {
  const desktop = selectDesktop();
  desktop?.notify(notice);
  return desktop !== null;
}

const NO_UPDATE: DesktopUpdate = { status: 'none' };

const updateSignal = createSignal();

let desktopUpdate: DesktopUpdate = NO_UPDATE;

let desktopChannel: UpdateChannel = 'stable';

let watchedDesktop: DesktopBridge | null = null;

function watchDesktopUpdate(desktop: DesktopBridge) {
  if (watchedDesktop === desktop) return;
  watchedDesktop = desktop;
  desktopUpdate = desktop.update;
  desktopChannel = desktop.channel;
  desktop.onUpdate((update) => {
    desktopUpdate = update;
    updateSignal.publish();
  });
}

export function selectDesktopBuild(): ShinsaBuild | null {
  const desktop = selectDesktop();
  return desktop ? { version: desktop.version, protocol: desktop.protocol } : null;
}

export function readDesktopUpdate(): DesktopUpdate {
  const desktop = selectDesktop();
  if (!desktop) return NO_UPDATE;
  watchDesktopUpdate(desktop);
  return desktopUpdate;
}

export function subscribeDesktopUpdate(listener: () => void) {
  const desktop = selectDesktop();
  if (desktop) watchDesktopUpdate(desktop);
  return updateSignal.subscribe(listener);
}

export function installDesktopUpdate() {
  selectDesktop()?.installUpdate();
}

export function checkDesktopUpdates() {
  selectDesktop()?.checkForUpdates();
}

export function answerDesktopDowngrade(accept: boolean) {
  selectDesktop()?.answerDowngrade(accept);
}

export function readDesktopChannel(): UpdateChannel | null {
  const desktop = selectDesktop();
  if (!desktop) return null;
  watchDesktopUpdate(desktop);
  return desktopChannel;
}

export function applyDesktopChannel(channel: UpdateChannel) {
  const desktop = selectDesktop();
  if (!desktop) return;
  watchDesktopUpdate(desktop);
  if (channel === desktopChannel) return;
  desktopChannel = channel;
  desktop.applyUpdateChannel(channel);
  updateSignal.publish();
}
