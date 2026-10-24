import { describe, expect, it } from 'bun:test';
import { describeCodeKey, isMacPlatform, resolveCodeKey } from '@/lib/code/keys.ts';

function press(
  key: string,
  modifiers: Partial<Record<'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'defaultPrevented', boolean>> = {}
) {
  return {
    key,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    defaultPrevented: false,
    ...modifiers,
  };
}

describe('resolveCodeKey', () => {
  it('reads ⌘P, ⇧⌘F, ⌘F and ⌘G on a Mac and the Ctrl keys elsewhere', () => {
    expect(resolveCodeKey(press('p', { metaKey: true }), true)).toBe('quick-open');
    expect(resolveCodeKey(press('F', { metaKey: true, shiftKey: true }), true)).toBe('search');
    expect(resolveCodeKey(press('f', { metaKey: true }), true)).toBe('find');
    expect(resolveCodeKey(press('g', { ctrlKey: true }), false)).toBe('goto-line');
  });

  it('leaves alone a key the editor already took, a wrong modifier or another letter', () => {
    expect(resolveCodeKey(press('f', { metaKey: true, defaultPrevented: true }), true)).toBeNull();
    expect(resolveCodeKey(press('p', { ctrlKey: true }), true)).toBeNull();
    expect(resolveCodeKey(press('p', { metaKey: true, altKey: true }), true)).toBeNull();
    expect(resolveCodeKey(press('k', { metaKey: true }), true)).toBeNull();
    expect(resolveCodeKey(press('g', { metaKey: true, shiftKey: true }), true)).toBeNull();
  });
});

describe('describeCodeKey', () => {
  it('writes the key as the platform shows it', () => {
    expect(describeCodeKey('search', true)).toBe('⇧⌘F');
    expect(describeCodeKey('quick-open', false)).toBe('Ctrl+P');
    expect(describeCodeKey('search', false)).toBe('Ctrl+Shift+F');
    expect(isMacPlatform('MacIntel')).toBe(true);
    expect(isMacPlatform('Linux x86_64')).toBe(false);
  });
});
