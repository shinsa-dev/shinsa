import { describe, expect, it } from 'bun:test';
import {
  hasLongPressMoved,
  replayMenuOpen,
  resolveClickReplay,
  resolveContextMenuReplay,
  resolveKeyReplay,
  resolvePointReplay,
} from '@/lib/lazy-menu.ts';

const POINT = { clientX: 10, clientY: 20, screenX: 110, screenY: 120 };

describe('menu replays', () => {
  it('replays a point as a right click there', () => {
    expect(resolvePointReplay(POINT, true)).toEqual({
      type: 'contextmenu',
      init: { ...POINT, button: 2 },
      focused: true,
    });
  });

  it('keeps the modifiers of a context menu', () => {
    const event = new MouseEvent('contextmenu', { ...POINT, shiftKey: true });
    expect(resolveContextMenuReplay(event, false).init).toMatchObject({
      ...POINT,
      button: 2,
      shiftKey: true,
    });
  });

  it('keeps the pointer type of a click, from the event when it has one', () => {
    const mouse = new MouseEvent('click', { ...POINT, detail: 1 });
    expect(resolveClickReplay(mouse, 'touch', false).init).toMatchObject({ pointerType: 'touch', detail: 1 });
    const pointer = new PointerEvent('click', { ...POINT, pointerType: 'pen' });
    expect(resolveClickReplay(pointer, 'touch', false).init).toMatchObject({ pointerType: 'pen' });
  });

  it('replays only the arrow keys', () => {
    expect(resolveKeyReplay(new KeyboardEvent('keydown', { key: 'Enter' }), false)).toBeNull();
    expect(resolveKeyReplay(new KeyboardEvent('keydown', { key: 'ArrowUp', code: 'ArrowUp' }), true)).toEqual(
      {
        type: 'keydown',
        init: {
          key: 'ArrowUp',
          code: 'ArrowUp',
          altKey: false,
          ctrlKey: false,
          metaKey: false,
          shiftKey: false,
        },
        focused: true,
      }
    );
  });

  it('cancels a long press that moves more than a few pixels', () => {
    expect(hasLongPressMoved(POINT, { ...POINT, clientX: 15 })).toBe(false);
    expect(hasLongPressMoved(POINT, { ...POINT, clientX: 21 })).toBe(true);
    expect(hasLongPressMoved(POINT, { ...POINT, clientY: 31 })).toBe(true);
  });

  it('dispatches the replayed event, focusing the trigger first when it had focus', () => {
    const button = document.createElement('button');
    document.body.append(button);
    const seen: string[] = [];
    for (const type of ['contextmenu', 'click', 'keydown'])
      button.addEventListener(type, (event) =>
        seen.push(`${event.type}:${document.activeElement === button}`)
      );
    replayMenuOpen(button, resolvePointReplay(POINT, false));
    replayMenuOpen(button, resolveClickReplay(new MouseEvent('click'), 'mouse', false));
    const key = resolveKeyReplay(new KeyboardEvent('keydown', { key: 'ArrowDown' }), true);
    if (key) replayMenuOpen(button, key);
    expect(seen).toEqual(['contextmenu:false', 'click:false', 'keydown:true']);
    button.remove();
  });
});
