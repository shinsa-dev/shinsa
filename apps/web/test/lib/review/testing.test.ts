import { describe, expect, it } from 'bun:test';
import { resolveTestTarget } from '@/lib/review/testing.ts';

describe('resolveTestTarget', () => {
  it('links a web address to open in the browser', () => {
    expect(resolveTestTarget({ kind: 'url', value: ' http://localhost:5173/orders ' })).toEqual({
      kind: 'link',
      href: 'http://localhost:5173/orders',
    });
  });

  it('names an address that is not a web link as plain text', () => {
    expect(resolveTestTarget({ kind: 'url', value: 'localhost:5173/orders' })).toEqual({
      kind: 'text',
      icon: 'IconGlobe',
      text: 'localhost:5173/orders',
    });
  });

  it('opens a file at its lines, from a path with a range or a shinsa file reference', () => {
    expect(resolveTestTarget({ kind: 'file', value: 'src/retry.ts:12-20' })).toEqual({
      kind: 'file',
      path: 'src/retry.ts',
      line: 12,
      end: 20,
    });
    expect(resolveTestTarget({ kind: 'file', value: 'shinsa://file/src/retry.ts#L4' })).toEqual({
      kind: 'file',
      path: 'src/retry.ts',
      line: 4,
      end: null,
    });
  });

  it('names a file it cannot read as plain text', () => {
    expect(resolveTestTarget({ kind: 'file', value: 'shinsa://task/abc' })).toEqual({
      kind: 'text',
      icon: 'IconFileText',
      text: 'shinsa://task/abc',
    });
  });

  it('keeps a command to copy or run, and a screen as its name', () => {
    expect(resolveTestTarget({ kind: 'command', value: 'bun run dev\n' })).toEqual({
      kind: 'command',
      command: 'bun run dev',
    });
    expect(resolveTestTarget({ kind: 'screen', value: 'Settings → Billing' })).toEqual({
      kind: 'text',
      icon: 'IconWindow',
      text: 'Settings → Billing',
    });
  });

  it('shows nothing for a step with no target or an empty one', () => {
    expect(resolveTestTarget(null)).toBeNull();
    expect(resolveTestTarget({ kind: 'screen', value: '  ' })).toBeNull();
  });
});
