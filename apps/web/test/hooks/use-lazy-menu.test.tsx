import { afterEach, describe, expect, it, jest } from 'bun:test';
import { DropdownMenuContent, DropdownMenuItem } from '@shinsa/ui/components/dropdown-menu';
import { act, fireEvent, render, screen } from '@testing-library/react';
import * as React from 'react';
import { LazyMenu, LazyMenuTrigger } from '@/components/controls/lazy-menu.tsx';
import { LONG_PRESS_MS } from '@/lib/lazy-menu.ts';

const TOUCH = { clientX: 10, clientY: 10, screenX: 10, screenY: 10 };

function ContextRow({ onContextMenu }: { onContextMenu?: () => void }) {
  return (
    <LazyMenu
      kind='context'
      content={
        <DropdownMenuContent>
          <DropdownMenuItem>Open task</DropdownMenuItem>
        </DropdownMenuContent>
      }
    >
      <LazyMenuTrigger
        render={
          <button type='button' data-testid='row' onContextMenu={onContextMenu} style={{ color: 'red' }} />
        }
      >
        Row
      </LazyMenuTrigger>
    </LazyMenu>
  );
}

function DropdownButton({ triggerRef }: { triggerRef?: React.Ref<HTMLElement> }) {
  return (
    <LazyMenu
      kind='dropdown'
      content={
        <DropdownMenuContent>
          <DropdownMenuItem>Waits on</DropdownMenuItem>
        </DropdownMenuContent>
      }
    >
      <LazyMenuTrigger ref={triggerRef} render={<button type='button' />}>
        More
      </LazyMenuTrigger>
    </LazyMenu>
  );
}

afterEach(() => {
  jest.useRealTimers();
});

function touch(target: HTMLElement, type: 'touchStart' | 'touchMove', touches: (typeof TOUCH)[]) {
  fireEvent[type](target, { touches });
}

describe('a lazy context menu', () => {
  it('mounts nothing of the menu until it is asked for, then opens where it was asked', async () => {
    const outer = jest.fn();
    render(<ContextRow onContextMenu={outer} />);
    const row = screen.getByTestId('row');
    expect(row.getAttribute('data-slot')).toBe('context-menu-trigger');
    expect(row.style.color).toBe('red');
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.contextMenu(row, TOUCH);
    expect(outer).toHaveBeenCalled();
    expect(await screen.findByRole('menu')).toBeTruthy();
  });

  it('opens on a long press that holds still', async () => {
    jest.useFakeTimers();
    render(<ContextRow />);
    const row = screen.getByTestId('row');
    touch(row, 'touchStart', [TOUCH]);
    touch(row, 'touchMove', [{ ...TOUCH, clientX: 12 }]);
    await act(async () => {
      jest.advanceTimersByTime(LONG_PRESS_MS);
    });
    jest.useRealTimers();
    expect(await screen.findByRole('menu')).toBeTruthy();
  });

  it('forgets a long press that moves, lifts, is cancelled or uses two fingers', async () => {
    jest.useFakeTimers();
    render(<ContextRow />);
    const row = screen.getByTestId('row');
    touch(row, 'touchStart', [TOUCH]);
    touch(row, 'touchMove', [{ ...TOUCH, clientX: 40 }]);
    touch(row, 'touchMove', [TOUCH]);
    touch(row, 'touchStart', [TOUCH]);
    touch(row, 'touchMove', [TOUCH, TOUCH]);
    touch(row, 'touchStart', [TOUCH]);
    fireEvent.touchEnd(row);
    touch(row, 'touchStart', [TOUCH]);
    fireEvent.touchCancel(row);
    touch(row, 'touchStart', [TOUCH, TOUCH]);
    await act(async () => {
      jest.advanceTimersByTime(LONG_PRESS_MS * 2);
    });
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('drops a pending long press when it unmounts', () => {
    jest.useFakeTimers();
    const view = render(<ContextRow />);
    touch(screen.getByTestId('row'), 'touchStart', [TOUCH]);
    view.unmount();
    expect(() => jest.advanceTimersByTime(LONG_PRESS_MS)).not.toThrow();
  });
});

describe('a lazy dropdown', () => {
  it('reads as a closed menu button, then opens on a click', async () => {
    const triggerRef = React.createRef<HTMLElement>();
    render(<DropdownButton triggerRef={triggerRef} />);
    const button = screen.getByRole('button', { name: 'More' });
    expect(triggerRef.current).toBe(button);
    expect(button.getAttribute('aria-haspopup')).toBe('menu');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    fireEvent.pointerDown(button, { pointerType: 'mouse' });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(await screen.findByRole('menu')).toBeTruthy();
  });

  it('opens from the keyboard with an arrow, and ignores other keys', async () => {
    const callbackRef = jest.fn();
    const view = render(<DropdownButton triggerRef={callbackRef} />);
    const button = screen.getByRole('button', { name: 'More' });
    act(() => button.focus());
    fireEvent.keyDown(button, { key: 'a' });
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.keyDown(button, { key: 'ArrowDown' });
    expect(await screen.findByRole('menu')).toBeTruthy();
    view.unmount();
    expect(callbackRef).toHaveBeenLastCalledWith(null);
  });

  it('needs a LazyMenu around its trigger', () => {
    const quiet = jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<LazyMenuTrigger render={<button type='button' />} />)).toThrow(
      'LazyMenuTrigger renders inside a LazyMenu.'
    );
    quiet.mockRestore();
  });
});
