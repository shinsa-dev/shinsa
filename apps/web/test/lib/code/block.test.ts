import { describe, expect, it } from 'bun:test';
import {
  countCodeLines,
  isRunnableFence,
  resolveBlockCommand,
  resolveBlockCopy,
  resolveCodeCorner,
} from '@/lib/code/block.ts';

describe('countCodeLines', () => {
  it('counts the lines a block shows, ignoring trailing newlines', () => {
    expect(countCodeLines('bun dev')).toBe(1);
    expect(countCodeLines('bun dev\n\n')).toBe(1);
    expect(countCodeLines('bun install\nbun dev')).toBe(2);
  });
});

describe('resolveCodeCorner', () => {
  it('centres the corner beside one line and keeps it at the top of several', () => {
    expect(resolveCodeCorner(`echo ${'x'.repeat(400)}`)).toBe('centre');
    expect(resolveCodeCorner('a\nb')).toBe('top');
  });
});

describe('isRunnableFence', () => {
  it('reads the run mark among the words after a fence language, and nothing else', () => {
    expect(isRunnableFence('run')).toBe(true);
    expect(isRunnableFence('title=setup  run')).toBe(true);
    expect(isRunnableFence('running')).toBe(false);
    expect(isRunnableFence('')).toBe(false);
    expect(isRunnableFence(null)).toBe(false);
    expect(isRunnableFence(undefined)).toBe(false);
  });
});

describe('resolveBlockCommand', () => {
  it('runs a shell block only when it is marked runnable, never a block that only opens on a $ prompt', () => {
    expect(resolveBlockCommand('$ bun dev', 'sh', true)).toBe('bun dev');
    expect(resolveBlockCommand('$ bun install\nadded 3 packages\n$ bun dev', 'console', true)).toBe(
      'bun install\nbun dev'
    );
    expect(resolveBlockCommand('bun dev', 'bash', false)).toBeNull();
    expect(resolveBlockCommand('$ bun dev', null, false)).toBeNull();
    expect(resolveBlockCommand('$ bun dev', null, true)).toBeNull();
    expect(resolveBlockCommand('const a = 1;', 'ts', true)).toBeNull();
  });
});

describe('resolveBlockCopy', () => {
  it('drops a leading $ prompt from a command block and leaves other code alone', () => {
    expect(resolveBlockCopy('$ bun install\nadded 3 packages\n  $ bun dev', 'console')).toBe(
      'bun install\nadded 3 packages\n  bun dev'
    );
    expect(resolveBlockCopy('$ bun dev', null)).toBe('bun dev');
    expect(resolveBlockCopy('const $ = 1;\n$ x', 'ts')).toBe('const $ = 1;\n$ x');
  });
});
