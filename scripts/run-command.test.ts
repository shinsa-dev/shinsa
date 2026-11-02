import { describe, expect, it } from 'bun:test';
import { runCommand } from './run-command.ts';

describe('running a command', () => {
  it('keeps its exit code and both streams', () => {
    expect(runCommand(['sh', '-c', 'echo out; echo err >&2; exit 3'])).toEqual({
      exitCode: 3,
      stdout: 'out\n',
      stderr: 'err\n',
    });
  });
});
