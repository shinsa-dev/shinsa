import { describe, expect, it } from 'bun:test';
import {
  describeGitHubToken,
  describeShareMachine,
  GITHUB_TOKEN_LABEL,
  isGitHubTokenShown,
} from '@/lib/shared-machine.ts';

describe('the shared machine settings', () => {
  it('asks before sharing a machine with a team and before taking it back', () => {
    expect(describeShareMachine('Laptop', 'Platform', true)).toMatchObject({
      title: 'Share Laptop with Platform?',
      action: 'Share machine',
      done: 'Shared with Platform.',
    });
    expect(describeShareMachine('Laptop', 'Platform', false)).toMatchObject({
      title: 'Stop sharing Laptop with Platform?',
      action: 'Stop sharing',
      done: 'Stopped sharing with Platform.',
    });
  });

  it('describes your GitHub token and shows it only to a member of a shared machine', () => {
    expect(describeGitHubToken({ saved: true, login: 'kai' })).toBe(GITHUB_TOKEN_LABEL.saved('kai'));
    expect(describeGitHubToken({ saved: false, login: 'kai' })).toBe(GITHUB_TOKEN_LABEL.missing);
    expect(isGitHubTokenShown({ machineLogin: false }, true)).toBe(true);
    expect(isGitHubTokenShown({ machineLogin: true }, true)).toBe(false);
    expect(isGitHubTokenShown({ machineLogin: false }, false)).toBe(false);
    expect(isGitHubTokenShown(null, true)).toBe(false);
  });
});
