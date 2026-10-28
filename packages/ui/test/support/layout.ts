const MEASURED = ['clientWidth', 'clientHeight', 'scrollWidth', 'scrollHeight'] as const;

type Measured = (typeof MEASURED)[number];

type Box = Partial<
  Record<Measured | 'scrollTop' | 'offsetLeft' | 'offsetTop' | 'offsetWidth' | 'offsetHeight', number> & {
    offsetParent: Element | null;
  }
>;

/** happy-dom lays nothing out; this gives one element the box a browser would have measured. */
export function place(element: Element, box: Box) {
  for (const [key, value] of Object.entries(box)) {
    Object.defineProperty(element, key, { configurable: true, get: () => value });
  }
}

/** The JSON a `data-layout` attribute carries, for elements React creates before a test can reach them. */
export function layout(box: Partial<Record<Measured, number>>) {
  return JSON.stringify(box);
}

/**
 * Makes every element report the size in its `data-layout` attribute (0 when
 * absent), so layout effects measure what the test describes.
 */
export function installLayout() {
  const originals = MEASURED.map(
    (key) => [key, Object.getOwnPropertyDescriptor(HTMLElement.prototype, key)] as const
  );
  for (const key of MEASURED) {
    Object.defineProperty(HTMLElement.prototype, key, {
      configurable: true,
      get(this: HTMLElement) {
        const raw = this.getAttribute('data-layout');
        return raw ? ((JSON.parse(raw) as Partial<Record<Measured, number>>)[key] ?? 0) : 0;
      },
    });
  }
  return () => {
    for (const [key, original] of originals) {
      if (original) Object.defineProperty(HTMLElement.prototype, key, original);
      else delete (HTMLElement.prototype as unknown as Record<string, unknown>)[key];
    }
  };
}

type Observer = { callback: ResizeObserverCallback; targets: Set<Element> };

/** A ResizeObserver the test fires by hand. */
export function installResizeObserver() {
  const original = globalThis.ResizeObserver;
  const observers = new Set<Observer>();

  class ManualResizeObserver {
    private readonly entry: Observer;
    constructor(callback: ResizeObserverCallback) {
      this.entry = { callback, targets: new Set() };
      observers.add(this.entry);
    }
    observe(target: Element) {
      this.entry.targets.add(target);
    }
    unobserve(target: Element) {
      this.entry.targets.delete(target);
    }
    disconnect() {
      this.entry.targets.clear();
      observers.delete(this.entry);
    }
  }

  globalThis.ResizeObserver = ManualResizeObserver as unknown as typeof ResizeObserver;

  return {
    resize(target: Element) {
      for (const observer of [...observers]) {
        if (observer.targets.has(target)) observer.callback([], observer as unknown as ResizeObserver);
      }
    },
    watching(target: Element) {
      return [...observers].some((observer) => observer.targets.has(target));
    },
    restore() {
      globalThis.ResizeObserver = original;
    },
  };
}

/** Lets MutationObserver callbacks and other queued work run. */
export function flush(ms = 0) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
