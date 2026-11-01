import * as React from 'react';
import { registerCodeSource } from '@/lib/connection/code.ts';
import { describeFailure } from '@/lib/connection/commands.ts';
import { createSharedCodeSource, resolveSharedHead } from '@/lib/share/code.ts';
import { requestSharedText, ShareGoneError } from '@/lib/share/sources.ts';
import { resolveSharedView, type SharedSource, type SharedView } from '@/lib/share/view.ts';

export type SharedViewLoad =
  | { status: 'loading' }
  | { status: 'error'; message: string; gone: boolean }
  | { status: 'ready'; view: SharedView };

function registerSharedCode(view: SharedView) {
  const { diffUrl, codeUrl } = view;
  return registerCodeSource(
    view.task.id,
    createSharedCodeSource({
      readDiff: diffUrl ? () => requestSharedText(diffUrl) : null,
      readCode: codeUrl ? () => requestSharedText(codeUrl) : null,
      branch: view.task.branch,
      head: resolveSharedHead(view.task),
    })
  );
}

function resolveFailure(error: unknown): SharedViewLoad {
  return { status: 'error', message: describeFailure(error), gone: error instanceof ShareGoneError };
}

export interface SharedViewHandlers {
  onSource: (source: SharedSource) => void;
  onError: (error: Error) => void;
}

export function useSharedView(
  key: string,
  subscribe: (handlers: SharedViewHandlers) => () => void
): SharedViewLoad {
  const [load, setLoad] = React.useState<SharedViewLoad>({ status: 'loading' });
  const subscribeRef = React.useRef(subscribe);
  subscribeRef.current = subscribe;
  const shownRef = React.useRef<(() => void) | null>(null);

  React.useEffect(() => {
    let alive = true;
    const stop = subscribeRef.current({
      onSource: (source) => {
        if (!alive) return;
        const view = resolveSharedView(source);
        shownRef.current?.();
        shownRef.current = registerSharedCode(view);
        setLoad({ status: 'ready', view });
      },
      onError: (error) => {
        if (alive && (!shownRef.current || error instanceof ShareGoneError)) setLoad(resolveFailure(error));
      },
    });
    return () => {
      alive = false;
      stop();
    };
  }, [key]);

  React.useEffect(
    () => () => {
      shownRef.current?.();
      shownRef.current = null;
    },
    []
  );
  return load;
}
