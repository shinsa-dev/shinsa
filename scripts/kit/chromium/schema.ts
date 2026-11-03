import type { CdpPage } from './page.ts';

export interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

export interface Message {
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { message: string };
}

export interface Evaluated<T> {
  result: { value: T };
  exceptionDetails?: { text?: string; exception?: { description?: string } };
}

export interface Target {
  type: string;
  url: string;
  webSocketDebuggerUrl: string;
}

export const PLAYWRIGHT_CACHE = 'Library/Caches/ms-playwright';

export const CHROMIUM_IN_BUILD =
  'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';

export const SYSTEM_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

export const POLL_MS = 50;

export const DESKTOP_WINDOW = { width: 1440, height: 1000 };

export const LAUNCH_TIMEOUT_MS = 30_000;

export const WAIT_TIMEOUT_MS = 15_000;

export interface Browser {
  page: CdpPage;
  close: () => void;
}
