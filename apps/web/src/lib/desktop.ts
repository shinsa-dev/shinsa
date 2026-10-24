type DesktopWindowState = 'window' | 'fullscreen';

export interface DesktopNotice {
  title: string;
  body: string;
  tag: string;
  path: string | null;
}

export interface DesktopBridge {
  version: string;
  windowState: DesktopWindowState;
  updateBadge: (count: number) => void;
  notify: (notice: DesktopNotice) => void;
  onNavigate: (listener: (path: string) => void) => () => void;
  onWindowState: (listener: (state: DesktopWindowState) => void) => () => void;
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
