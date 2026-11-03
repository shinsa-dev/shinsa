import { join } from 'node:path';
import { CORE_DEFAULTS, createWindowLookup } from '@chroxify/eunoe';
import type { EunoeLink, EunoeStatus, EunoeWatcher } from '../agents/providers/claude/index.ts';
import { DIRECT_BASE_URL } from '../agents/providers/claude/route.ts';
import { edgeRuntime } from '../runtime/edge.ts';
import { type EunoeServerOptions, FOLD_FLOOR_TOKENS, THREADS_DIR } from './schema.ts';
import type { EunoeServerHandle } from './server/schema.ts';
import { makeEunoeServer } from './server/service.ts';
import { createFileStore } from './threads.ts';

export { isStuck, resolveCompactionNotice } from './notices.ts';
export type { EunoeServerOptions } from './schema.ts';
export { createFileStore } from './threads.ts';

export class EunoeServer implements EunoeLink {
  readonly dir: string;
  readonly #handle: EunoeServerHandle;

  constructor(options: EunoeServerOptions) {
    this.dir = options.dir;
    this.#handle = edgeRuntime.runSync(
      makeEunoeServer({
        dir: options.dir,
        upstream: options.upstream ?? DIRECT_BASE_URL,
        port: options.port ?? 0,
        window: options.window ?? createWindowLookup(),
        config: { ...CORE_DEFAULTS, mode: 'compact', ...options.tuning },
        store: createFileStore(join(options.dir, THREADS_DIR)),
        foldFloor: options.foldFloor ?? FOLD_FLOOR_TOKENS,
      })
    );
  }

  ensure(): Promise<EunoeStatus> {
    return edgeRuntime.runPromise(this.#handle.ensure);
  }

  watch(sessionId: string, watcher: EunoeWatcher) {
    const unwatch = edgeRuntime.runSync(this.#handle.watch(sessionId, watcher));
    return () => edgeRuntime.runSync(unwatch);
  }

  fold(sessionId: string, warm: boolean) {
    const release = edgeRuntime.runSync(this.#handle.fold(sessionId, warm));
    return () => edgeRuntime.runSync(release);
  }

  stop() {
    return edgeRuntime.runPromise(this.#handle.stop);
  }
}
