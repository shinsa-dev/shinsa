export const RECHECK_INTERVAL_MS = 60_000;

export const RECHECK_FRESH_MS = 5_000;

export type RecheckResult = { ok: true } | { ok: false; error: unknown };

export interface RecheckPage {
  isVisible: () => boolean;
  onVisibilityChange: (listener: () => void) => () => void;
}

export interface UsageRecheckOptions {
  refresh: () => Promise<unknown>;
  read?: () => Promise<unknown>;
  intervalMs?: number;
  freshMs?: number;
  now?: () => number;
  page?: RecheckPage;
}

export const DOCUMENT_PAGE: RecheckPage = {
  isVisible: () => document.visibilityState === 'visible',
  onVisibilityChange: (listener) => {
    document.addEventListener('visibilitychange', listener);
    return () => document.removeEventListener('visibilitychange', listener);
  },
};

export function createUsageRecheck(options: UsageRecheckOptions) {
  const intervalMs = options.intervalMs ?? RECHECK_INTERVAL_MS;
  const freshMs = options.freshMs ?? RECHECK_FRESH_MS;
  const now = options.now ?? Date.now;
  const page = options.page ?? DOCUMENT_PAGE;
  const read = options.read ?? options.refresh;
  let running: Promise<RecheckResult> | null = null;
  let checkedAt = Number.NEGATIVE_INFINITY;
  let watchers = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopListening: (() => void) | null = null;

  function clear() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }

  function schedule() {
    clear();
    if (watchers === 0 || running !== null || !page.isVisible()) return;
    timer = setTimeout(() => void start(read), Math.max(0, checkedAt + intervalMs - now()));
  }

  function settle(result: RecheckResult) {
    running = null;
    checkedAt = now();
    schedule();
    return result;
  }

  function start(request: () => Promise<unknown>) {
    clear();
    running ??= request().then(
      (): RecheckResult => settle({ ok: true }),
      (error: unknown): RecheckResult => settle({ ok: false, error })
    );
    return running;
  }

  function check() {
    return start(options.refresh);
  }

  function wake(staleAfterMs: number) {
    if (!page.isVisible() || running !== null) {
      clear();
      return;
    }
    if (now() - checkedAt >= staleAfterMs) void start(read);
    else schedule();
  }

  function watch() {
    watchers += 1;
    if (watchers === 1) stopListening = page.onVisibilityChange(() => wake(intervalMs));
    wake(freshMs);
    let watching = true;
    return () => {
      if (!watching) return;
      watching = false;
      watchers -= 1;
      if (watchers > 0) return;
      clear();
      stopListening?.();
      stopListening = null;
    };
  }

  function reset() {
    clear();
    running = null;
    checkedAt = Number.NEGATIVE_INFINITY;
  }

  return { check, watch, reset };
}
