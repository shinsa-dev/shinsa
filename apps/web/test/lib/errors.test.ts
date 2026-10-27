import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { toast } from '@shinsa/ui/components/sonner';
import { act, renderHook } from '@testing-library/react';
import { useCommandMenuOpen, writeCommandMenuOpen } from '@/lib/command/registry.ts';
import * as commands from '@/lib/connection/commands.ts';
import { ERROR_COPY, recordCommandMenuError, resolveRenderError, resolveResetKey } from '@/lib/errors.ts';

describe('resolveRenderError', () => {
  it('shows an error’s message and keeps its stack and where it was rendered for the details', () => {
    const error = new TypeError('Cannot read properties of undefined (reading ‘filter’)');
    error.stack = 'TypeError: Cannot read properties of undefined\n    at listProjectServices';
    const resolved = resolveRenderError(error, '\n    at ServicesMenu\n    at header\n');
    expect(resolved.message).toBe('Cannot read properties of undefined (reading ‘filter’)');
    expect(resolved.details).toBe(
      'TypeError: Cannot read properties of undefined\n    at listProjectServices\n\nComponent stack:\nat ServicesMenu\n    at header'
    );
  });

  it('names an error without a message, and reads a thrown value that is not an error', () => {
    const bare = new RangeError('Out of range');
    bare.message = '';
    bare.stack = '';
    expect(resolveRenderError(bare, null)).toEqual({ message: 'RangeError', details: 'RangeError' });
    expect(resolveRenderError('the socket closed', '   ')).toEqual({
      message: 'the socket closed',
      details: 'the socket closed',
    });
    expect(resolveRenderError(42, null).message).toBe('42');
  });
});

describe('resolveResetKey', () => {
  it('changes with the route, its search and each new visit to the same page', () => {
    const home = resolveResetKey({ route: { name: 'home' }, search: '' });
    expect(home).toBe(resolveResetKey({ route: { name: 'home' }, search: '' }, 0));
    expect(home).not.toBe(resolveResetKey({ route: { name: 'tasks' }, search: '' }));
    expect(home).not.toBe(resolveResetKey({ route: { name: 'home' }, search: '?tab=code' }));
    expect(home).not.toBe(resolveResetKey({ route: { name: 'home' }, search: '' }, 1));
  });
});

describe('recordCommandMenuError', () => {
  let error: ReturnType<typeof spyOn>;
  let copied: ReturnType<typeof spyOn>;

  beforeEach(() => {
    error = spyOn(toast, 'error').mockReturnValue('id');
    copied = spyOn(commands, 'copyText').mockResolvedValue(true);
  });

  afterEach(() => {
    error.mockRestore();
    copied.mockRestore();
    writeCommandMenuOpen(false);
  });

  it('closes the command menu and says so in a toast whose action copies the details', () => {
    writeCommandMenuOpen(true);
    const open = renderHook(() => useCommandMenuOpen());
    act(() =>
      recordCommandMenuError({ message: 'No frame', details: 'Error: No frame\n    at CommandMenu' })
    );
    expect(open.result.current).toBe(false);
    const [title, options] = error.mock.calls[0] as [
      string,
      { description: string; action: { onClick: () => void } },
    ];
    expect(title).toBe(ERROR_COPY.commandMenu);
    expect(options.description).toBe('No frame');
    options.action.onClick();
    expect(copied).toHaveBeenCalledWith('Error: No frame\n    at CommandMenu');
  });
});
