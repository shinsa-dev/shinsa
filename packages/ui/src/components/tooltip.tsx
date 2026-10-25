'use client';

import { Tooltip as TooltipPrimitive } from '@base-ui/react/tooltip';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';

/*
 * One tooltip for the whole page. The outermost `TooltipProvider` mounts a
 * single Base UI tooltip root and listens for hover, focus, taps and Escape on
 * the document. A trigger is only its own element, registered by a ref and
 * marked `data-tooltip-trigger`: no root, state or listener of its own, so a
 * page full of hints costs nothing until one opens. What a tooltip shows is
 * read when it opens, so content that is costly to build is built only then.
 */

type TooltipSide = 'top' | 'bottom' | 'left' | 'right' | 'inline-start' | 'inline-end';

type TooltipAlign = 'start' | 'center' | 'end';

interface TooltipOptions {
  content: React.ReactNode;
  className?: string;
  side?: TooltipSide;
  align?: TooltipAlign;
  sideOffset?: number;
  alignOffset?: number;
  /** Milliseconds the pointer rests on the trigger before it opens; the provider's when unset. */
  delay?: number;
  /** Follow the pointer down the trigger instead of centring on it. */
  trackCursorAxis?: 'y';
}

type TooltipSource = TooltipOptions | (() => TooltipOptions | null) | null;

interface TooltipRecord {
  source: TooltipSource;
  providerDelay: number;
}

interface TooltipVirtualAnchor {
  contextElement: Element;
  getBoundingClientRect: () => DOMRect;
}

interface TooltipView {
  open: boolean;
  options: TooltipOptions | null;
  anchor: Element | TooltipVirtualAnchor | null;
}

type OpenedBy = 'pointer' | 'focus' | 'tap';

type TriggerElement = React.ReactElement<Record<string, unknown>>;

const TRIGGER_ATTRIBUTE = 'data-tooltip-trigger';

const CLOSED: TooltipView = { open: false, options: null, anchor: null };

function readOptions(record: TooltipRecord) {
  return typeof record.source === 'function' ? record.source() : record.source;
}

function hasHover() {
  return typeof window.matchMedia !== 'function' || window.matchMedia('(hover: hover)').matches;
}

function followCursor(element: Element, y: number): TooltipVirtualAnchor {
  return {
    contextElement: element,
    getBoundingClientRect() {
      const box = element.getBoundingClientRect();
      return new DOMRect(box.x, y, box.width, 0);
    },
  };
}

/** The page's one open (or opening) tooltip and the triggers that can open it. */
class TooltipStore {
  readonly triggers = new WeakMap<Element, TooltipRecord>();
  popup: HTMLElement | null = null;
  #render: (view: TooltipView) => void = () => undefined;
  #popupId = '';
  #view: TooltipView = CLOSED;
  #current: { element: Element; record: TooltipRecord; marks: string[] } | null = null;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #frame = 0;
  #pointerModality = false;
  #openedBy: OpenedBy = 'pointer';
  #dismissed: Element | null = null;

  attach(element: Element, record: TooltipRecord) {
    this.triggers.set(element, record);
    return () => {
      this.triggers.delete(element);
      if (this.#current?.element === element) this.hide();
    };
  }

  refresh(record: TooltipRecord) {
    if (!this.#view.open || this.#current?.record !== record) return;
    const options = readOptions(record);
    if (options) this.#show({ ...this.#view, options });
    else this.hide();
  }

  hide = () => {
    clearTimeout(this.#timer);
    const current = this.#current;
    if (!current) return;
    this.#current = null;
    for (const name of current.marks) current.element.removeAttribute(name);
    if (this.#view.open) this.#show({ ...this.#view, open: false });
  };

  connect(render: (view: TooltipView) => void, popupId: string) {
    this.#render = render;
    this.#popupId = popupId;
    const listeners = [
      ['pointerover', this.#onPointerOver],
      ['pointerout', this.#onPointerOut],
      ['pointermove', this.#onPointerMove],
      ['pointerdown', this.#onPointerDown],
      ['click', this.#onClick],
      ['focusin', this.#onFocusIn],
      ['focusout', this.#onFocusOut],
      ['keydown', this.#onKeyDown],
    ] as const;
    for (const [type, listener] of listeners)
      document.addEventListener(type, listener as EventListener, true);
    return () => {
      for (const [type, listener] of listeners)
        document.removeEventListener(type, listener as EventListener, true);
      this.hide();
      cancelAnimationFrame(this.#frame);
      this.#render = () => undefined;
    };
  }

  #show(view: TooltipView) {
    this.#view = view;
    this.#render(view);
  }

  #open(element: Element, record: TooltipRecord, by: OpenedBy, y?: number) {
    clearTimeout(this.#timer);
    const options = readOptions(record);
    if (!options || !element.isConnected) return;
    const marks: string[] = [];
    if (!element.hasAttribute('aria-describedby')) {
      element.setAttribute('aria-describedby', this.#popupId);
      marks.push('aria-describedby');
    }
    if (!element.hasAttribute('data-popup-open')) {
      element.setAttribute('data-popup-open', '');
      marks.push('data-popup-open');
    }
    this.#current = { element, record, marks };
    this.#openedBy = by;
    const anchor = options.trackCursorAxis === 'y' && y !== undefined ? followCursor(element, y) : element;
    this.#show({ open: true, options, anchor });
  }

  #select(target: EventTarget | null) {
    if (!(target instanceof Element)) return null;
    const element = target.closest(`[${TRIGGER_ATTRIBUTE}]`);
    const record = element ? this.triggers.get(element) : undefined;
    return element && record ? { element, record } : null;
  }

  #isInPopup(target: EventTarget | null) {
    return target instanceof Node && !!this.popup?.contains(target);
  }

  #dismiss() {
    this.#dismissed = this.#current?.element ?? null;
    this.hide();
  }

  #onPointerOver = (event: PointerEvent) => {
    if (event.pointerType === 'touch') return;
    const trigger = this.#select(event.target);
    if (trigger && trigger.element === (this.#current?.element ?? this.#dismissed)) return;
    this.#dismissed = null;
    if (!trigger) {
      if (!this.#isInPopup(event.target)) this.hide();
      return;
    }
    this.hide();
    const { element, record } = trigger;
    const delay = readOptions(record)?.delay ?? record.providerDelay;
    const open = () => this.#open(element, record, 'pointer', event.clientY);
    if (delay <= 0) {
      open();
      return;
    }
    this.#current = { element, record, marks: [] };
    this.#timer = setTimeout(open, delay);
  };

  #onPointerOut = (event: PointerEvent) => {
    if (event.relatedTarget !== null || event.pointerType === 'touch') return;
    this.#dismissed = null;
    this.hide();
  };

  #onPointerMove = (event: PointerEvent) => {
    const current = this.#current;
    if (!current || !this.#view.open || this.#view.options?.trackCursorAxis !== 'y') return;
    if (!(event.target instanceof Node) || !current.element.contains(event.target)) return;
    cancelAnimationFrame(this.#frame);
    const y = event.clientY;
    this.#frame = requestAnimationFrame(() => {
      if (this.#current === current) this.#show({ ...this.#view, anchor: followCursor(current.element, y) });
    });
  };

  #onPointerDown = (event: PointerEvent) => {
    this.#pointerModality = true;
    if (this.#isInPopup(event.target)) return;
    const inTrigger = event.target instanceof Node && !!this.#current?.element.contains(event.target);
    if (inTrigger && (event.pointerType === 'touch' || !hasHover())) return;
    if (inTrigger) this.#dismiss();
    else this.hide();
  };

  #onClick = (event: MouseEvent) => {
    if (hasHover()) return;
    const trigger = this.#select(event.target);
    if (!trigger) {
      if (!this.#isInPopup(event.target)) this.hide();
      return;
    }
    const wasOpen = this.#view.open && this.#current?.element === trigger.element;
    this.hide();
    if (!wasOpen) this.#open(trigger.element, trigger.record, 'tap');
  };

  #onFocusIn = (event: FocusEvent) => {
    if (this.#pointerModality) return;
    const trigger = this.#select(event.target);
    if (!trigger || trigger.element === this.#current?.element) return;
    if (!trigger.element.matches(':focus-visible')) return;
    this.hide();
    this.#open(trigger.element, trigger.record, 'focus');
  };

  #onFocusOut = (event: FocusEvent) => {
    const current = this.#current;
    if (!current || this.#openedBy !== 'focus') return;
    if (event.relatedTarget instanceof Node && current.element.contains(event.relatedTarget)) return;
    this.hide();
  };

  #onKeyDown = (event: KeyboardEvent) => {
    this.#pointerModality = false;
    if (event.key === 'Escape') this.#dismiss();
  };
}

interface TooltipGroup {
  options: Omit<TooltipOptions, 'delay' | 'trackCursorAxis'> | null;
  delay?: number;
  trackCursorAxis?: 'y';
}

const TooltipStoreContext = React.createContext<TooltipStore | null>(null);

const TooltipDelayContext = React.createContext(0);

const TooltipGroupContext = React.createContext<TooltipGroup | null>(null);

function TooltipPopup({ store }: { store: TooltipStore }) {
  const [view, setView] = React.useState(CLOSED);
  const id = React.useId();
  React.useEffect(() => store.connect(setView, id), [store, id]);
  const options = view.options;

  return (
    <TooltipPrimitive.Root
      open={view.open}
      onOpenChange={(open) => {
        if (!open) store.hide();
      }}
    >
      {options && (
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Positioner
            anchor={view.anchor}
            align={options.align ?? 'center'}
            alignOffset={options.alignOffset ?? 0}
            side={options.side ?? 'top'}
            sideOffset={options.sideOffset ?? 4}
            className='isolate z-50'
          >
            {/* A compact popover-coloured chip with a hairline border and no arrow; the offset alone reads as attached. */}
            <TooltipPrimitive.Popup
              ref={(element) => {
                store.popup = element;
              }}
              id={id}
              data-slot='tooltip-content'
              className={cn(
                'corner-superellipse/1.125 data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-left-2 data-[side=inline-start]:slide-in-from-right-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[state=delayed-open]:fade-in-0 data-[state=delayed-open]:zoom-in-95 data-open:fade-in-0 data-open:zoom-in-95 data-closed:fade-out-0 data-closed:zoom-out-95 z-50 inline-flex min-h-6 w-fit max-w-72 origin-(--transform-origin) items-center gap-1 rounded-control border border-border bg-popover px-2 py-1 text-2xs text-fg-4 leading-[1.35] has-data-[slot=kbd]:py-0.5 has-data-[slot=kbd]:pr-0.5 data-[state=delayed-open]:animate-in data-closed:animate-out data-open:animate-in **:data-[slot=kbd]:relative **:data-[slot=kbd]:isolate **:data-[slot=kbd]:z-50 **:data-[slot=kbd]:h-4 **:data-[slot=kbd]:rounded-sm **:data-[slot=kbd]:bg-bg-a2 **:data-[slot=kbd]:text-fg-3',
                options.className
              )}
            >
              {options.content}
            </TooltipPrimitive.Popup>
          </TooltipPrimitive.Positioner>
        </TooltipPrimitive.Portal>
      )}
    </TooltipPrimitive.Root>
  );
}

/**
 * The outermost provider mounts the page's one tooltip; a nested one only sets
 * how long the pointer rests on the triggers inside it before one opens.
 */
function TooltipProvider({ delay, children }: { delay?: number; children?: React.ReactNode }) {
  const parent = React.useContext(TooltipStoreContext);
  const [store] = React.useState(() => parent ?? new TooltipStore());
  const content = <TooltipDelayContext.Provider value={delay ?? 0}>{children}</TooltipDelayContext.Provider>;
  if (parent) return delay === undefined ? children : content;
  return (
    <TooltipStoreContext.Provider value={store}>
      {content}
      <TooltipPopup store={store} />
    </TooltipStoreContext.Provider>
  );
}

function assignRef<T>(ref: React.Ref<T> | undefined, value: T | null) {
  if (typeof ref === 'function') return ref(value);
  if (ref) ref.current = value;
}

/**
 * Makes `element` open a tooltip: it comes back with a ref that registers it
 * with the page's tooltip, the `data-tooltip-trigger` marker and, unless it
 * names its own, `data-slot="tooltip-trigger"`. `tooltip` is read when it
 * opens; `null` leaves the element without one.
 */
function useTooltipTrigger(element: TriggerElement, tooltip: TooltipSource) {
  const store = React.useContext(TooltipStoreContext);
  const providerDelay = React.useContext(TooltipDelayContext);
  const [record] = React.useState<TooltipRecord>(() => ({ source: null, providerDelay: 0 }));
  record.source = tooltip;
  record.providerDelay = providerDelay;

  React.useEffect(() => store?.refresh(record));

  const ownRef = element.props.ref as React.Ref<Element> | undefined;
  const ref = React.useCallback(
    (node: Element | null) => {
      const cleanup = assignRef(ownRef, node);
      const release = node && store ? store.attach(node, record) : undefined;
      return () => {
        release?.();
        if (typeof cleanup === 'function') cleanup();
        else assignRef(ownRef, null);
      };
    },
    [ownRef, store, record]
  );

  return React.cloneElement(element, {
    ref,
    'data-slot': element.props['data-slot'] ?? 'tooltip-trigger',
    [TRIGGER_ATTRIBUTE]: tooltip ? '' : undefined,
  });
}

/** Pairs a `TooltipTrigger` with the `TooltipContent` it opens. */
function Tooltip({
  delay,
  trackCursorAxis,
  children,
}: {
  delay?: number;
  trackCursorAxis?: 'y';
  children?: React.ReactNode;
}) {
  const [group] = React.useState<TooltipGroup>(() => ({ options: null }));
  group.delay = delay;
  group.trackCursorAxis = trackCursorAxis;
  return <TooltipGroupContext.Provider value={group}>{children}</TooltipGroupContext.Provider>;
}

function mergeTriggerProps(own: Record<string, unknown>, extra: Record<string, unknown>) {
  const merged: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(extra)) {
    if (value === undefined) continue;
    const first = own[name];
    if (/^on[A-Z]/.test(name) && typeof value === 'function' && typeof first === 'function') {
      merged[name] = (...args: unknown[]) => {
        first(...args);
        value(...args);
      };
    } else {
      merged[name] = value;
    }
  }
  return merged;
}

/** The element that opens its `Tooltip`: `render`, or a button. */
function TooltipTrigger({ render, ...props }: React.ComponentProps<'button'> & { render?: TriggerElement }) {
  const group = React.useContext(TooltipGroupContext);
  const element = render ?? <button type='button' />;
  const read = React.useCallback(() => {
    if (!group?.options) return null;
    return { delay: group.delay, trackCursorAxis: group.trackCursorAxis, ...group.options };
  }, [group]);
  return useTooltipTrigger(
    React.cloneElement(element, mergeTriggerProps(element.props, props)),
    group ? read : null
  );
}

/** What its `Tooltip` shows, rendered by the page's tooltip once it opens. */
function TooltipContent({
  children,
  ...options
}: Omit<TooltipOptions, 'content' | 'delay' | 'trackCursorAxis'> & { children?: React.ReactNode }) {
  const group = React.useContext(TooltipGroupContext);
  if (group) group.options = { ...options, content: children };
  return null;
}

function TooltipLabel({ className, ...props }: React.ComponentProps<'span'>) {
  return <span data-slot='tooltip-label' className={cn('text-fg-2', className)} {...props} />;
}

export { Tooltip, TooltipContent, TooltipLabel, TooltipProvider, TooltipTrigger, useTooltipTrigger };
