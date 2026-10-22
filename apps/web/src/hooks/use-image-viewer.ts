import * as React from 'react';

export interface ViewerImage {
  src: string;
  caption?: string | null;
}

export function useImageViewer() {
  const [index, setIndex] = React.useState<number | null>(null);
  const origins = React.useRef(new Map<number, HTMLElement>());
  const callbacks = React.useRef(new Map<number, (element: HTMLElement | null) => void>());

  const resolveOrigin = React.useCallback((at: number) => origins.current.get(at) ?? null, []);

  const recordOrigin = React.useCallback((at: number) => {
    const known = callbacks.current.get(at);
    if (known) return known;
    const callback = (element: HTMLElement | null) => {
      if (element) origins.current.set(at, element);
      else origins.current.delete(at);
    };
    callbacks.current.set(at, callback);
    return callback;
  }, []);

  const close = React.useCallback(() => setIndex(null), []);

  return { index, show: setIndex, close, recordOrigin, resolveOrigin };
}
