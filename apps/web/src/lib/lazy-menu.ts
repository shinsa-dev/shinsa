export type LazyMenuKind = 'context' | 'dropdown';

export type MenuReplay =
  | { type: 'contextmenu'; init: MouseEventInit; focused: boolean }
  | { type: 'click'; init: PointerEventInit; focused: boolean }
  | { type: 'keydown'; init: KeyboardEventInit; focused: boolean };

export interface MenuPoint {
  clientX: number;
  clientY: number;
  screenX: number;
  screenY: number;
}

export const LONG_PRESS_MS = 500;

const LONG_PRESS_SLOP = 10;

function readModifiers(event: MouseEvent | KeyboardEvent) {
  return {
    altKey: event.altKey,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
    shiftKey: event.shiftKey,
  };
}

export function resolvePointReplay(point: MenuPoint, focused: boolean): MenuReplay {
  const { clientX, clientY, screenX, screenY } = point;
  return { type: 'contextmenu', init: { clientX, clientY, screenX, screenY, button: 2 }, focused };
}

export function resolveContextMenuReplay(event: MouseEvent, focused: boolean): MenuReplay {
  const replay = resolvePointReplay(event, focused);
  return { ...replay, init: { ...replay.init, ...readModifiers(event) } };
}

export function resolveClickReplay(event: MouseEvent, pointerType: string, focused: boolean): MenuReplay {
  const { clientX, clientY, screenX, screenY, button, detail } = event;
  const type = 'pointerType' in event ? String(event.pointerType) : pointerType;
  return {
    type: 'click',
    init: { clientX, clientY, screenX, screenY, button, detail, pointerType: type, ...readModifiers(event) },
    focused,
  };
}

export function resolveKeyReplay(event: KeyboardEvent, focused: boolean): MenuReplay | null {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return null;
  return { type: 'keydown', init: { key: event.key, code: event.code, ...readModifiers(event) }, focused };
}

export function hasLongPressMoved(start: MenuPoint, now: MenuPoint) {
  return (
    Math.abs(now.clientX - start.clientX) > LONG_PRESS_SLOP ||
    Math.abs(now.clientY - start.clientY) > LONG_PRESS_SLOP
  );
}

function createReplayEvent(replay: MenuReplay) {
  const base = { bubbles: true, cancelable: true, composed: true };
  if (replay.type === 'contextmenu') return new MouseEvent('contextmenu', { ...base, ...replay.init });
  if (replay.type === 'click') return new PointerEvent('click', { ...base, ...replay.init });
  return new KeyboardEvent('keydown', { ...base, ...replay.init });
}

export function replayMenuOpen(element: HTMLElement, replay: MenuReplay) {
  if (replay.focused) element.focus({ preventScroll: true });
  element.dispatchEvent(createReplayEvent(replay));
}
