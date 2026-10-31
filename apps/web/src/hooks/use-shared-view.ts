import * as React from 'react';
import { registerCodeSource } from '@/lib/connection/code.ts';
import { describeFailure } from '@/lib/connection/commands.ts';
import { createSharedCodeSource } from '@/lib/share/code.ts';
import { requestDiffText, ShareGoneError } from '@/lib/share/sources.ts';
import { resolveSharedView, type SharedSource, type SharedView } from '@/lib/share/view.ts';

export type SharedViewLoad =
  | { status: 'loading' }
  | { status: 'error'; message: string; gone: boolean }
  | { status: 'ready'; view: SharedView };

function registerSharedCode(view: SharedView) {
  const { diffUrl } = view;
  const readDiff = diffUrl ? () => requestDiffText(diffUrl) : null;
  return registerCodeSource(view.task.id, createSharedCodeSource(readDiff, view.task.branch));
}

export function useSharedView(key: string, request: () => Promise<SharedSource>): SharedViewLoad {
  const [load, setLoad] = React.useState<SharedViewLoad>({ status: 'loading' });
  const requestRef = React.useRef(request);
  requestRef.current = request;
  React.useEffect(() => {
    let alive = true;
    let release: () => void = () => undefined;
    setLoad({ status: 'loading' });
    requestRef.current().then(
      (source) => {
        if (!alive) return;
        const view = resolveSharedView(source);
        release = registerSharedCode(view);
        setLoad({ status: 'ready', view });
      },
      (error: unknown) => {
        if (alive)
          setLoad({
            status: 'error',
            message: describeFailure(error),
            gone: error instanceof ShareGoneError,
          });
      }
    );
    return () => {
      alive = false;
      release();
    };
  }, [key]);
  return load;
}
