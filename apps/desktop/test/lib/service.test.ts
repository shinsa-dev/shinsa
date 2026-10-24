import { describe, expect, it } from 'bun:test';
import {
  describeWaiting,
  resolveLoginShell,
  START_COMMANDS,
  summarizeOutput,
} from '../../src/lib/service.ts';

describe('starting the service', () => {
  it('restarts the service first, and installs it when there is none', () => {
    expect(START_COMMANDS).toEqual(['shinsa service restart', 'shinsa service install']);
  });

  it('runs the commands in your login shell', () => {
    expect(resolveLoginShell({ SHELL: '/opt/homebrew/bin/fish' })).toBe('/opt/homebrew/bin/fish');
    expect(resolveLoginShell({ SHELL: 'zsh' })).toBe('/bin/zsh');
    expect(resolveLoginShell({})).toBe('/bin/zsh');
  });

  it('keeps the last lines of what the commands printed', () => {
    const output = [
      '$ shinsa service restart',
      '',
      ...Array.from({ length: 8 }, (_, i) => `line ${i}  `),
    ].join('\n');
    expect(summarizeOutput(output)).toBe(
      ['line 2', 'line 3', 'line 4', 'line 5', 'line 6', 'line 7'].join('\n')
    );
  });

  it('says how to start Shinsa, for the app and for a checkout', () => {
    expect(describeWaiting(true)).toContain('shinsa service install');
    expect(describeWaiting(false)).toContain('bun dev');
  });
});
