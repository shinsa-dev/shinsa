import { ContextMenu, ContextMenuTrigger } from '@shinsa/ui/components/context-menu';
import { DropdownMenu, DropdownMenuTrigger } from '@shinsa/ui/components/dropdown-menu';
import * as React from 'react';
import { type LazyMenuState, useLazyMenu } from '@/hooks/use-lazy-menu.ts';
import type { LazyMenuKind } from '@/lib/lazy-menu.ts';

type TriggerElement = React.ReactElement<Record<string, unknown>>;

type Handler = (event: React.SyntheticEvent) => void;

const TOUCH_CALLOUT: React.CSSProperties = { WebkitTouchCallout: 'none' };

const LazyMenuContext = React.createContext<LazyMenuState | null>(null);

const CLOSED_TRIGGER: Record<LazyMenuKind, Record<string, unknown>> = {
  context: { 'data-slot': 'context-menu-trigger' },
  dropdown: { 'data-slot': 'dropdown-menu-trigger', 'aria-haspopup': 'menu', 'aria-expanded': false },
};

function assignRef<T>(ref: React.Ref<T> | undefined, value: T | null) {
  if (typeof ref === 'function') return ref(value);
  if (ref) ref.current = value;
}

function mergeHandlers(...layers: Record<string, unknown>[]) {
  const merged: Record<string, Handler> = {};
  for (const layer of layers) {
    for (const [name, value] of Object.entries(layer)) {
      if (!/^on[A-Z]/.test(name) || typeof value !== 'function') continue;
      const first = merged[name];
      const next = value as Handler;
      merged[name] = first
        ? (event) => {
            first(event);
            next(event);
          }
        : next;
    }
  }
  return merged;
}

export function LazyMenu({
  kind,
  content,
  children,
}: {
  kind: LazyMenuKind;
  content: React.ReactNode;
  children: React.ReactNode;
}) {
  const menu = useLazyMenu(kind);
  const Root = kind === 'context' ? ContextMenu : DropdownMenu;
  return (
    <LazyMenuContext.Provider value={menu}>
      {menu.mounted ? (
        <Root>
          {children}
          {content}
        </Root>
      ) : (
        children
      )}
    </LazyMenuContext.Provider>
  );
}

export function LazyMenuTrigger({
  render,
  ref,
  ...props
}: Record<string, unknown> & {
  render: TriggerElement;
  children?: React.ReactNode;
  ref?: React.Ref<HTMLElement>;
}) {
  const menu = React.useContext(LazyMenuContext);
  if (!menu) throw new Error('LazyMenuTrigger renders inside a LazyMenu.');
  const { triggerRef } = menu;
  const renderRef = render.props.ref as React.Ref<HTMLElement> | undefined;
  const mergedRef = React.useCallback(
    (node: HTMLElement | null) => {
      triggerRef.current = node;
      const cleanups = [renderRef, ref].map((each) => ({ each, cleanup: assignRef(each, node) }));
      return () => {
        triggerRef.current = null;
        for (const { each, cleanup } of cleanups) {
          if (typeof cleanup === 'function') cleanup();
          else assignRef(each, null);
        }
      };
    },
    [ref, renderRef, triggerRef]
  );
  if (menu.mounted) {
    const Trigger = menu.kind === 'context' ? ContextMenuTrigger : DropdownMenuTrigger;
    return <Trigger ref={mergedRef} render={render} {...props} />;
  }
  return React.cloneElement(render, {
    ...CLOSED_TRIGGER[menu.kind],
    ...props,
    ...mergeHandlers(render.props, props, menu.triggerProps),
    style: {
      ...(menu.kind === 'context' && TOUCH_CALLOUT),
      ...(render.props.style as React.CSSProperties | undefined),
      ...(props.style as React.CSSProperties | undefined),
    },
    ref: mergedRef,
  });
}
