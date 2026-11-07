import { describe, expect, it } from 'bun:test';
import {
  describeGitHubToken,
  describeSharedMachineSaved,
  GITHUB_TOKEN_LABEL,
  isGitHubTokenShown,
  resolveSharedPatch,
} from '@/lib/shared-machine.ts';

describe('the shared machine settings', () => {
  it('says whether the machine is shared and writes the setting', () => {
    expect(describeSharedMachineSaved(true)).toBe('Shared machine is on.');
    expect(describeSharedMachineSaved(false)).toBe('Shared machine is off.');
    expect(resolveSharedPatch(true)).toEqual({ sharedMachine: true });
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
