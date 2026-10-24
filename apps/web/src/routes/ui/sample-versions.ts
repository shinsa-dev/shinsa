import type { ProgramVersion, VersionsSnapshot } from '@shinsa/core';

const CLAUDE: ProgramVersion = {
  id: 'claude',
  label: 'Claude Code',
  path: '/Users/me/.local/bin/claude',
  version: '2.1.287',
  latest: '2.1.310',
  minimum: '2.1.280',
  status: 'update_available',
  updater: 'claude update',
  override: null,
  updating: false,
};

const CODEX: ProgramVersion = {
  id: 'codex',
  label: 'Codex',
  path: '/Users/me/.local/bin/codex',
  version: '0.164.0',
  latest: '0.164.0',
  minimum: '0.153.0',
  status: 'current',
  updater: 'codex update',
  override: null,
  updating: false,
};

const SDK: VersionsSnapshot['sdk'] = {
  name: '@anthropic-ai/claude-agent-sdk',
  version: '0.3.280',
  latest: '0.3.310',
  claudeCodeVersion: '2.1.280',
};

export function createSampleVersions(): { label: string; snapshot: VersionsSnapshot }[] {
  return [
    {
      label: 'VersionsGroup · Claude Code behind the latest, Codex up to date, a newer Agent SDK published',
      snapshot: { programs: [CLAUDE, CODEX], sdk: SDK, latestCheckedAt: 1 },
    },
    {
      label: 'VersionsGroup · Claude Code too old for Shinsa and updating, Codex not installed',
      snapshot: {
        programs: [
          { ...CLAUDE, version: '2.1.100', status: 'outdated', updating: true },
          { ...CODEX, path: null, version: null, status: 'not_installed', updater: null },
        ],
        sdk: { ...SDK, latest: SDK.version },
        latestCheckedAt: 1,
      },
    },
    {
      label: 'VersionsGroup · Claude Code set by CLAUDE_EXECUTABLE, the latest unknown',
      snapshot: {
        programs: [
          {
            ...CLAUDE,
            version: null,
            latest: null,
            status: 'unknown',
            updater: null,
            override: '/opt/bin/claude-bedrock',
          },
          { ...CODEX, latest: null },
        ],
        sdk: { ...SDK, latest: null },
        latestCheckedAt: null,
      },
    },
  ];
}
