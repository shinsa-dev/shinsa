type Callback = (entries: Pick<IntersectionObserverEntry, 'isIntersecting'>[]) => void;

export class FakeIntersectionObserver {
  static observers: FakeIntersectionObserver[] = [];
  readonly callback: Callback;
  readonly options: IntersectionObserverInit | undefined;
  observed: Element[] = [];
  disconnected = false;

  constructor(callback: Callback, options?: IntersectionObserverInit) {
    this.callback = callback;
    this.options = options;
    FakeIntersectionObserver.observers.push(this);
  }

  observe(element: Element) {
    this.observed.push(element);
  }

  disconnect() {
    this.disconnected = true;
  }

  static report(isIntersecting: boolean) {
    for (const observer of FakeIntersectionObserver.observers) {
      if (!observer.disconnected) observer.callback([{ isIntersecting }]);
    }
  }
}

export function installIntersectionObserver() {
  const real = globalThis.IntersectionObserver;
  FakeIntersectionObserver.observers = [];
  globalThis.IntersectionObserver = FakeIntersectionObserver as unknown as typeof IntersectionObserver;
  return () => {
    globalThis.IntersectionObserver = real;
  };
}
