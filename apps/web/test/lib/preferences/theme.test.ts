import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { act, renderHook, waitFor } from '@testing-library/react';
import {
  followSystemTheme,
  readColorScheme,
  useColorScheme,
  useThemePreference,
  writeThemePreference,
} from '@/lib/preferences/theme.ts';

let systemDark = false;
const listeners = new Set<() => void>();
const realMatchMedia = globalThis.matchMedia;

function changeSystem(dark: boolean) {
  systemDark = dark;
  for (const listener of listeners) listener();
}

function classes() {
  return [...document.documentElement.classList].sort();
}

beforeEach(() => {
  systemDark = false;
  listeners.clear();
  globalThis.matchMedia = ((query: string) => ({
    media: query,
    get matches() {
      return query === '(prefers-color-scheme: dark)' && systemDark;
    },
    addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
  })) as unknown as typeof matchMedia;
});

afterEach(() => {
  globalThis.matchMedia = realMatchMedia;
  document.documentElement.className = '';
});

describe('theme preference', () => {
  it('defaults to following the system', () => {
    expect(renderHook(() => useThemePreference()).result.current).toBe('system');
  });

  it('falls back to the system when the stored value is not a theme', () => {
    localStorage.setItem('shinsa.theme', 'sepia');
    expect(renderHook(() => useThemePreference()).result.current).toBe('system');
  });

  it('stores the theme, applies its class and updates readers', () => {
    const { result } = renderHook(() => useThemePreference());
    act(() => writeThemePreference('dark'));
    expect(result.current).toBe('dark');
    expect(localStorage.getItem('shinsa.theme')).toBe('dark');
    expect(classes()).toEqual(['dark']);
    act(() => writeThemePreference('light'));
    expect(classes()).toEqual(['light']);
  });

  it('applies the system theme when set to system', () => {
    systemDark = true;
    writeThemePreference('system');
    expect(classes()).toEqual(['dark']);
  });
});

describe('followSystemTheme', () => {
  it('applies the stored theme straight away', () => {
    localStorage.setItem('shinsa.theme', 'dark');
    const stop = followSystemTheme();
    expect(classes()).toEqual(['dark']);
    stop();
  });

  it('follows the system while the preference is system', () => {
    const stop = followSystemTheme();
    expect(classes()).toEqual(['light']);
    changeSystem(true);
    expect(classes()).toEqual(['dark']);
    stop();
    changeSystem(false);
    expect(classes()).toEqual(['dark']);
  });

  it('keeps an explicit theme when the system changes', () => {
    localStorage.setItem('shinsa.theme', 'light');
    const stop = followSystemTheme();
    changeSystem(true);
    expect(classes()).toEqual(['light']);
    stop();
  });
});

describe('useColorScheme', () => {
  it('reads the scheme the page shows and follows a change of theme', async () => {
    expect(readColorScheme()).toBe('light');
    const view = renderHook(() => useColorScheme());
    expect(view.result.current).toBe('light');
    act(() => writeThemePreference('dark'));
    await waitFor(() => expect(view.result.current).toBe('dark'));
    view.unmount();
  });
});
