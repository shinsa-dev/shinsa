import * as React from 'react';
import { registerCodeSource } from '@/lib/connection/code.ts';
import { describeFailure } from '@/lib/connection/commands.ts';
import { createSharedCodeSource, resolveSharedHead } from '@/lib/share/code.ts';
import { requestDiffText, ShareGoneError } from '@/lib/share/sources.ts';
import { resolveSharedView, type SharedSource, type SharedView } from '@/lib/share/view.ts';

export type SharedViewLoad =
  | { status: 'loading' }
  | { status: 'error'; message: string; gone: boolean }
  | { status: 'ready'; view: SharedView };

function registerSharedCode(view: SharedView) {
  const { diffUrl } = view;
  const readDiff = diffUrl ? () => requestDiffText(diffUrl) : null;
  return registerCodeSource(
    view.task.id,
    createSharedCodeSource(readDiff, view.task.branch, resolveSharedHead(view.task))
  );
}

function resolveFailure(error: unknown): SharedViewLoad {
  return { status: 'error', message: describeFailure(error), gone: error instanceof ShareGoneError };
}

export function useSharedView(
  key: string,
  request: () => Promise<SharedSource>,
  refreshMs: number | null = null
): SharedViewLoad {
  const [load, setLoad] = React.useState<SharedViewLoad>({ status: 'loading' });
  const requestRef = React.useRef(request);
  requestRef.current = request;
  const shownRef = React.useRef<{ updatedAt: number; release: () => void } | null>(null);

  React.useEffect(() => {
    let alive = true;
    const show = (source: SharedSource) => {
      if (shownRef.current?.updatedAt === source.updatedAt) return;
      const view = resolveSharedView(source);
      shownRef.current?.release();
      shownRef.current = { updatedAt: source.updatedAt, release: registerSharedCode(view) };
      setLoad({ status: 'ready', view });
    };
    const read = () =>
      requestRef.current().then(
        (source) => {
          if (alive) show(source);
        },
        (error: unknown) => {
          if (alive && (!shownRef.current || error instanceof ShareGoneError)) setLoad(resolveFailure(error));
        }
      );
    void read();
    if (refreshMs === null) {
      return () => {
        alive = false;
      };
    }
    const refresh = () => {
      if (document.visibilityState === 'visible') void read();
    };
    const timer = setInterval(refresh, refreshMs);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      alive = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [key, refreshMs]);

  React.useEffect(
    () => () => {
      shownRef.current?.release();
      shownRef.current = null;
    },
    []
  );
  return load;
}
