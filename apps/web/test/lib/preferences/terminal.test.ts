import { afterEach, describe, expect, it } from 'bun:test';
import {
  changeTerminalFontSize,
  readTerminalFontSize,
  resolveFontSize,
  subscribeTerminalFontSize,
  TERMINAL_FONT_SIZE,
} from '@/lib/preferences/terminal.ts';

afterEach(() => localStorage.clear());

describe('the terminal’s font size', () => {
  it('starts at the Code tab’s size and ignores a stored value it cannot use', () => {
    expect(readTerminalFontSize()).toBe(TERMINAL_FONT_SIZE.initial);
    localStorage.setItem('shinsa.terminal-font-size', '99');
    expect(readTerminalFontSize()).toBe(TERMINAL_FONT_SIZE.initial);
    localStorage.setItem('shinsa.terminal-font-size', '14');
    expect(readTerminalFontSize()).toBe(14);
  });

  it('grows and shrinks a step at a time within its bounds, and goes back to the start', () => {
    expect(resolveFontSize(12, 'larger')).toBe(13);
    expect(resolveFontSize(12, 'smaller')).toBe(11);
    expect(resolveFontSize(TERMINAL_FONT_SIZE.max, 'larger')).toBe(TERMINAL_FONT_SIZE.max);
    expect(resolveFontSize(TERMINAL_FONT_SIZE.min, 'smaller')).toBe(TERMINAL_FONT_SIZE.min);
    expect(resolveFontSize(20, 'reset')).toBe(TERMINAL_FONT_SIZE.initial);
  });

  it('keeps the size you chose and tells every terminal', () => {
    let told = 0;
    const stop = subscribeTerminalFontSize(() => {
      told += 1;
    });
    expect(changeTerminalFontSize('larger')).toBe(13);
    expect(readTerminalFontSize()).toBe(13);
    expect(changeTerminalFontSize('reset')).toBe(TERMINAL_FONT_SIZE.initial);
    expect(localStorage.getItem('shinsa.terminal-font-size')).toBeNull();
    expect(told).toBe(2);
    stop();
  });
});
