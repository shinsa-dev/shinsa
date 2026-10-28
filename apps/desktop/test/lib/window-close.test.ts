import { describe, expect, it } from 'bun:test';
import { resolveCloseAction } from '../../src/lib/window-close.ts';

describe('resolveCloseAction', () => {
  it('closes the window once the app is quitting, in full screen too', () => {
    expect(resolveCloseAction({ quitting: true, fullScreen: false })).toBe('close');
    expect(resolveCloseAction({ quitting: true, fullScreen: true })).toBe('close');
  });

  it('hides the window when you close it without quitting', () => {
    expect(resolveCloseAction({ quitting: false, fullScreen: false })).toBe('hide');
  });

  it('leaves full screen before hiding a full-screen window', () => {
    expect(resolveCloseAction({ quitting: false, fullScreen: true })).toBe('leave-full-screen');
  });
});
