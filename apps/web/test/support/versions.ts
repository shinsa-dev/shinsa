import type { ProgramVersion, VersionsSnapshot } from '@shinsa/core';

export function createProgram(overrides: Partial<ProgramVersion> = {}): ProgramVersion {
  return {
    id: 'claude',
    label: 'Claude Code',
    path: '/opt/bin/claude',
    version: '2.1.287',
    latest: '2.1.310',
    minimum: '2.1.280',
    status: 'update_available',
    updater: 'claude update',
    override: null,
    updating: false,
    ...overrides,
  };
}

export function createVersions(overrides: Partial<VersionsSnapshot> = {}): VersionsSnapshot {
  return {
    programs: [
      createProgram(),
      createProgram({
        id: 'codex',
        label: 'Codex',
        path: '/opt/bin/codex',
        version: '0.164.0',
        latest: '0.164.0',
        minimum: '0.153.0',
        status: 'current',
        updater: 'codex update',
      }),
    ],
    sdk: {
      name: '@anthropic-ai/claude-agent-sdk',
      version: '0.3.280',
      latest: '0.3.310',
      claudeCodeVersion: '2.1.280',
    },
    latestCheckedAt: 1,
    ...overrides,
  };
}
