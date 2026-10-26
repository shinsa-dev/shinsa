import { describe, expect, it } from 'bun:test';
import { isShellFence, resolveFenceCommand } from '@/lib/terminal/command.ts';

describe('isShellFence', () => {
  it('knows the languages a shell command is written in', () => {
    expect(isShellFence('sh')).toBe(true);
    expect(isShellFence('Bash')).toBe(true);
    expect(isShellFence('console')).toBe(true);
    expect(isShellFence('ts')).toBe(false);
    expect(isShellFence(null)).toBe(false);
  });
});

describe('resolveFenceCommand', () => {
  it('takes the commands of a shell block, without comments or blank lines', () => {
    expect(resolveFenceCommand('# sign in first\ngh auth login\n\nbun dev  ', 'sh')).toBe(
      'gh auth login\nbun dev'
    );
  });

  it('takes only the prompted lines of a session, without their prompt or output', () => {
    expect(resolveFenceCommand('$ bun install\nadded 3 packages\n$ bun dev', 'console')).toBe(
      'bun install\nbun dev'
    );
  });

  it('has nothing to run outside a shell block, in an empty one or in one too long to type', () => {
    expect(resolveFenceCommand('const a = 1', 'ts')).toBeNull();
    expect(resolveFenceCommand('# only a comment', 'sh')).toBeNull();
    expect(resolveFenceCommand(`echo ${'x'.repeat(5000)}`, 'sh')).toBeNull();
  });
});
