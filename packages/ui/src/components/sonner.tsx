'use client';

import { Icon } from '@shinsa/ui/components/icon';
import { Spinner } from '@shinsa/ui/components/spinner';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import { type ExternalToast, Toaster as Sonner, toast as sonnerToast, type ToasterProps } from 'sonner';

type Kind = 'default' | 'success' | 'info' | 'warning' | 'error';
type MessageArg = string | React.ReactNode;
type ToastId = string | number;

const KINDS: readonly string[] = ['default', 'success', 'info', 'warning', 'error'] satisfies Kind[];

function isKind(value: string): value is Kind {
  return KINDS.includes(value);
}

function instanceClass(instance: number) {
  return `bk-toast-i-${instance}`;
}

function playAttentionCue(el: HTMLElement, kind: Kind) {
  const animation = kind === 'error' || kind === 'warning' ? 'bk-toast-shake' : 'bk-toast-bump';
  el.classList.remove('bk-toast-shake', 'bk-toast-bump');
  void el.offsetWidth;
  el.classList.add(animation);
}

function pingInstance(instance: number, kind: Kind) {
  const el = document.querySelector<HTMLElement>(`[data-sonner-toast].${instanceClass(instance)}`);
  if (el) playAttentionCue(el, kind);
}

/** Sonner renders a fired toast on a zero-delay timeout, so the cue waits for that render, then a frame. */
function pingAfterRender(instance: number, kind: Kind) {
  setTimeout(() => requestAnimationFrame(() => pingInstance(instance, kind)));
}

function isInstanceAtTop(instance: number): boolean {
  const first = document.querySelector<HTMLElement>(
    '[data-sonner-toaster] [data-sonner-toast]:not([data-removed="true"])'
  );
  return first?.classList.contains(instanceClass(instance)) ?? false;
}

/**
 * Watches live toasts for a `data-type` change from loading → result. That
 * transition is how sonner expresses a settled promise; we play the same
 * attention cue used for duplicate fires so the UX stays consistent.
 */
function usePromiseSettleCue() {
  React.useEffect(() => {
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        const el = mutation.target as HTMLElement;
        if (!el.matches('[data-sonner-toast].bk-toast')) continue;
        const next = el.getAttribute('data-type');
        if (mutation.oldValue === 'loading' && next && next !== 'loading') {
          playAttentionCue(el, isKind(next) ? next : 'default');
        }
      }
    });
    observer.observe(document.body, {
      subtree: true,
      attributes: true,
      attributeOldValue: true,
      attributeFilter: ['data-type'],
    });
    return () => observer.disconnect();
  }, []);
}

function Toaster(props: ToasterProps) {
  usePromiseSettleCue();

  return (
    <Sonner
      className='toaster group'
      position='top-center'
      offset={{ top: 12 }}
      mobileOffset={{ top: 12 }}
      gap={8}
      icons={{
        success: <Icon name='IconCheckCircle2Filled' className='size-4 text-primary-4' />,
        info: <Icon name='IconInfoSimple' className='size-4 text-primary-4' />,
        warning: <Icon name='IconExclamationTriangleFilled' className='size-4 text-amber-4' />,
        error: <Icon name='IconExclamationCircleFilled' className='icon-solid size-4 text-red-4' />,
        loading: <Spinner className='text-fg-2' />,
      }}
      style={
        {
          // The real background is set inline below (so alpha survives sonner's
          // own stylesheet); these stay as fallbacks.
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'transparent',
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: 'bk-toast corner-superellipse/1.125 cursor-default rounded-popup font-medium',
          // Sonner ships its own button styling; override to our button language.
          actionButton:
            'bk-toast-button corner-superellipse/1.125 !h-6 !cursor-pointer !rounded-control-sm !bg-primary !px-2.5 !font-medium !text-primary-foreground !text-xs',
          cancelButton:
            'bk-toast-button corner-superellipse/1.125 !h-6 !cursor-pointer !rounded-control-sm !bg-bg-a2 !px-2.5 !font-medium !text-fg-3 !text-xs',
          closeButton:
            'bk-toast-button corner-superellipse/1.125 !cursor-pointer !rounded-control !bg-bg-2 !text-fg-3',
        },
        // Inline style beats sonner's injected stylesheet.
        style: { fontSize: '13px', backgroundColor: 'var(--popover)', userSelect: 'none' },
      }}
      {...props}
    />
  );
}

/* ── Deduped fire helpers ─────────────────────────────────────────────────
 * If a toast with the same kind and text is already on screen we don't spawn
 * a duplicate, we ping the existing one instead:
 *   error / warning → shake (grab attention)
 *   default / success / info → bump (subtle acknowledgement)
 * Only string messages dedupe: a React node has no stable identity to compare
 * (and serialising one walks React's internal, circular owner chain).
 * Cues animate `translate` / `scale` so they compose with sonner's own
 * transform-driven stack positioning.
 * ────────────────────────────────────────────────────────────────────── */

type Live = { id: string; instance: number };
const live = new Map<string, Live>();
let instances = 0;

/**
 * A loading toast is a sonner `promise` toast under the hood, which buys
 * sonner's native loader → result cross-fade when the caller later settles it
 * with `toast.success(message, { id })`. This holds each promise's settle
 * handlers until then.
 */
type Settled = { kind: Kind; message: React.ReactNode };
type LoadingHandle = { resolve: (value: Settled) => void; reject: (value: Settled) => void };
const pendingLoadings = new Map<ToastId, LoadingHandle>();

function callSonner(kind: Kind, message: MessageArg, options: ExternalToast): ToastId {
  switch (kind) {
    case 'success':
      return sonnerToast.success(message, options);
    case 'error':
      return sonnerToast.error(message, options);
    case 'warning':
      return sonnerToast.warning(message, options);
    case 'info':
      return sonnerToast.info(message, options);
    default:
      return sonnerToast(message, options);
  }
}

function track(signature: string, entry: Live, options: ExternalToast): ExternalToast {
  const forget = () => {
    if (live.get(signature)?.id === entry.id) live.delete(signature);
  };
  return {
    ...options,
    id: entry.id,
    className: cn(instanceClass(entry.instance), options.className),
    onDismiss: (shown) => {
      forget();
      options.onDismiss?.(shown);
    },
    onAutoClose: (shown) => {
      forget();
      options.onAutoClose?.(shown);
    },
  };
}

function fire(kind: Kind, message: MessageArg, options: ExternalToast = {}): ToastId {
  if (options.id != null) {
    const handle = pendingLoadings.get(options.id);
    if (!handle) return callSonner(kind, message, options);
    pendingLoadings.delete(options.id);
    if (kind === 'error' || kind === 'warning') handle.reject({ kind, message });
    else handle.resolve({ kind, message });
    return options.id;
  }

  if (typeof message !== 'string') return callSonner(kind, message, options);

  const signature = `${kind}:${message}`;
  const previous = live.get(signature);

  if (previous && isInstanceAtTop(previous.instance)) {
    const id = callSonner(kind, message, track(signature, previous, options));
    pingAfterRender(previous.instance, kind);
    return id;
  }

  if (previous) sonnerToast.dismiss(previous.id);

  instances += 1;
  const entry = { id: `toast-${instances}`, instance: instances };
  live.set(signature, entry);
  const id = callSonner(kind, message, track(signature, entry, options));
  if (previous) pingAfterRender(entry.instance, kind);
  return id;
}

function settledAs({ kind, message }: Settled) {
  return { message, type: kind } as unknown as React.ReactNode;
}

const toast = Object.assign(
  (message: MessageArg, options?: ExternalToast): ToastId => fire('default', message, options),
  {
    success: (message: MessageArg, options?: ExternalToast): ToastId => fire('success', message, options),
    error: (message: MessageArg, options?: ExternalToast): ToastId => fire('error', message, options),
    warning: (message: MessageArg, options?: ExternalToast): ToastId => fire('warning', message, options),
    info: (message: MessageArg, options?: ExternalToast): ToastId => fire('info', message, options),
    loading: (message: MessageArg, options: ExternalToast = {}): ToastId => {
      instances += 1;
      const id = options.id ?? `loading-${instances}`;
      const settled = new Promise<Settled>((resolve, reject) => {
        pendingLoadings.set(id, { resolve, reject });
      });
      sonnerToast.promise(settled, {
        ...options,
        id,
        loading: message,
        success: settledAs,
        error: settledAs,
      });
      return id;
    },
    promise: <T,>(
      promise: Promise<T> | (() => Promise<T>),
      options: Parameters<typeof sonnerToast.promise<T>>[1]
    ): ToastId | undefined => {
      const handle: unknown = sonnerToast.promise(promise, options);
      if (handle instanceof String || handle instanceof Number) return handle.valueOf();
      return undefined;
    },
    dismiss: (id?: ToastId): ToastId | undefined => {
      if (id === undefined) pendingLoadings.clear();
      else pendingLoadings.delete(id);
      return sonnerToast.dismiss(id);
    },
    custom: (jsx: (id: ToastId) => React.ReactElement, options?: ExternalToast): ToastId =>
      sonnerToast.custom(jsx, options),
    message: (message: MessageArg, options?: ExternalToast): ToastId => sonnerToast.message(message, options),
  }
);

export { Toaster, toast };
