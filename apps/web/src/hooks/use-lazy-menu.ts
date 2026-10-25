import * as React from 'react';
import {
  hasLongPressMoved,
  type LazyMenuKind,
  LONG_PRESS_MS,
  type MenuPoint,
  type MenuReplay,
  replayMenuOpen,
  resolveClickReplay,
  resolveContextMenuReplay,
  resolveKeyReplay,
  resolvePointReplay,
} from '@/lib/lazy-menu.ts';

interface LongPress {
  point: MenuPoint;
  timer: ReturnType<typeof setTimeout>;
}

function isFocused(event: React.SyntheticEvent<HTMLElement>) {
  return event.currentTarget.ownerDocument.activeElement === event.currentTarget;
}

function readTouchPoint(touch: React.Touch): MenuPoint {
  return { clientX: touch.clientX, clientY: touch.clientY, screenX: touch.screenX, screenY: touch.screenY };
}

export function useLazyMenu(kind: LazyMenuKind) {
  const [mounted, setMounted] = React.useState(false);
  const pending = React.useRef<MenuReplay | null>(null);
  const triggerRef = React.useRef<HTMLElement | null>(null);
  const pointerType = React.useRef('');
  const longPress = React.useRef<LongPress | null>(null);

  React.useEffect(() => {
    const replay = pending.current;
    const element = triggerRef.current;
    if (!mounted || !replay || !element) return;
    pending.current = null;
    replayMenuOpen(element, replay);
  }, [mounted]);

  React.useEffect(() => () => clearTimeout(longPress.current?.timer), []);

  const triggerProps = React.useMemo(() => {
    function mount(replay: MenuReplay) {
      if (pending.current) return;
      pending.current = replay;
      setMounted(true);
    }
    function cancelLongPress() {
      clearTimeout(longPress.current?.timer);
      longPress.current = null;
    }
    if (kind === 'context') {
      return {
        onContextMenu(event: React.MouseEvent<HTMLElement>) {
          event.preventDefault();
          event.stopPropagation();
          cancelLongPress();
          mount(resolveContextMenuReplay(event.nativeEvent, isFocused(event)));
        },
        onTouchStart(event: React.TouchEvent<HTMLElement>) {
          cancelLongPress();
          const touch = event.touches[0];
          if (event.touches.length !== 1 || !touch) return;
          const point = readTouchPoint(touch);
          const focused = isFocused(event);
          const timer = setTimeout(() => {
            longPress.current = null;
            mount(resolvePointReplay(point, focused));
          }, LONG_PRESS_MS);
          longPress.current = { point, timer };
        },
        onTouchMove(event: React.TouchEvent<HTMLElement>) {
          const press = longPress.current;
          const touch = event.touches[0];
          if (!press) return;
          if (event.touches.length !== 1 || !touch || hasLongPressMoved(press.point, readTouchPoint(touch))) {
            cancelLongPress();
          }
        },
        onTouchEnd: cancelLongPress,
        onTouchCancel: cancelLongPress,
      };
    }
    return {
      onPointerDown(event: React.PointerEvent<HTMLElement>) {
        pointerType.current = event.pointerType;
      },
      onClick(event: React.MouseEvent<HTMLElement>) {
        event.stopPropagation();
        mount(resolveClickReplay(event.nativeEvent, pointerType.current, isFocused(event)));
      },
      onKeyDown(event: React.KeyboardEvent<HTMLElement>) {
        const replay = resolveKeyReplay(event.nativeEvent, isFocused(event));
        if (!replay) return;
        event.preventDefault();
        event.stopPropagation();
        mount(replay);
      },
    };
  }, [kind]);

  return React.useMemo(() => ({ kind, mounted, triggerRef, triggerProps }), [kind, mounted, triggerProps]);
}

export type LazyMenuState = ReturnType<typeof useLazyMenu>;
