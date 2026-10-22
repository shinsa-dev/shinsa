import { describe, expect, it } from 'bun:test';
import { cn } from '../../src/lib/utils';

describe('cn', () => {
  it('joins truthy classes and drops falsy ones', () => {
    expect(cn('a', false, null, undefined, 0, 'b', { c: true, d: false }, ['e', ['f']])).toBe('a b c e f');
  });

  it('lets the later of two conflicting stock utilities win', () => {
    expect(cn('px-2 text-fg-2', 'px-3')).toBe('text-fg-2 px-3');
    expect(cn('h-6', undefined, 'h-6.5')).toBe('h-6.5');
  });

  it('keeps a size and a colour that share the text- prefix', () => {
    expect(cn('text-xs', 'text-fg-4')).toBe('text-xs text-fg-4');
    expect(cn('text-2xs', 'text-fg-2')).toBe('text-2xs text-fg-2');
  });

  it('merges the theme corners, so an override replaces the primitive corner', () => {
    expect(cn('rounded-control', 'rounded-popup')).toBe('rounded-popup');
    expect(cn('rounded-lg', 'rounded-item')).toBe('rounded-item');
    expect(cn('rounded-segment', 'rounded-full')).toBe('rounded-full');
  });

  it('merges the theme shadows and leading', () => {
    expect(cn('shadow-control', 'shadow-md')).toBe('shadow-md');
    expect(cn('shadow-1', 'shadow-control-elevated-hover')).toBe('shadow-control-elevated-hover');
    expect(cn('leading-tighter', 'leading-4')).toBe('leading-4');
  });

  it('keeps a shadow colour apart from a shadow size', () => {
    expect(cn('shadow-control', 'shadow-red-4')).toBe('shadow-control shadow-red-4');
  });
});
