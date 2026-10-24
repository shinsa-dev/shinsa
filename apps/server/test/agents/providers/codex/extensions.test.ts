import { describe, expect, test } from 'bun:test';
import type { ChatEvent } from '@shinsa/core';
import {
  resolveCodexServerConfig,
  resolveCodexSkillInstructions,
} from '../../../../src/agents/providers/codex/extensions.ts';
import { startCodexSession } from '../../../../src/agents/providers/codex/session.ts';
import { createShinsaTools } from '../../../../src/agents/tools/index.ts';
import type { McpDefinition } from '../../../../src/extensions/definitions.ts';
import type { SessionExtensions } from '../../../../src/extensions/index.ts';
import { FakeCodex } from '../../../helpers/codex.ts';
import { createTempDir } from '../../../helpers/index.ts';

function definition(overrides: Partial<McpDefinition>): McpDefinition {
  return {
    transport: 'stdio',
    command: null,
    args: [],
    env: {},
    cwd: null,
    url: null,
    headers: {},
    bearerTokenEnv: null,
    ...overrides,
  };
}

const EXTENSIONS: SessionExtensions = {
  servers: [
    {
      name: 'files',
      claudeName: 'files',
      definition: definition({ command: 'npx', args: ['files'], env: { ROOT: '/x' }, cwd: '/tmp' }),
    },
    { name: 'plain', claudeName: 'plain', definition: definition({ command: 'plain' }) },
    {
      name: 'docs',
      claudeName: 'docs',
      definition: definition({
        transport: 'http',
        url: 'https://docs.dev/mcp',
        headers: { Authorization: 'Bearer t' },
      }),
    },
  ],
  skills: [
    {
      name: 'review',
      description: 'Reviews.',
      path: '/plugin/skills/review/SKILL.md',
      claudeName: 'shinsa:review',
      source: 'shinsa',
    },
    {
      name: 'animate',
      description: '',
      path: '/home/.claude/skills/animate/SKILL.md',
      claudeName: 'animate',
      source: 'user',
    },
    {
      name: 'release',
      description: 'Cuts a release.',
      path: '/codex/skills/release/SKILL.md',
      claudeName: null,
      source: 'codex',
    },
  ],
  plugins: { 'docs@market': true },
  skillsOff: [],
  codexServersOff: ['kampala'],
  deferred: [],
  deferredSkills: [],
  loaded: {
    servers: [{ name: 'files', tokens: 900 }],
    skills: [{ name: 'shinsa:review', tokens: 30 }],
    plugins: [{ name: 'docs', tokens: 80 }],
  },
};

describe('what a Codex agent is given', () => {
  test('the servers that are on in Codex’s own spelling, and the Codex servers that are off switched off', () => {
    expect(resolveCodexServerConfig(undefined)).toEqual({});
    expect(resolveCodexServerConfig(EXTENSIONS)).toEqual({
      'mcp_servers.kampala.enabled': false,
      'mcp_servers.files': { command: 'npx', args: ['files'], env: { ROOT: '/x' }, cwd: '/tmp' },
      'mcp_servers.plain': { command: 'plain', args: [], env: {} },
      'mcp_servers.docs': { url: 'https://docs.dev/mcp', http_headers: { Authorization: 'Bearer t' } },
    });
  });

  test('every skill but Codex’s own as a file to read, since Codex loads its own', () => {
    expect(resolveCodexSkillInstructions(EXTENSIONS)).toBe(
      [
        '## Skills',
        'Read these files with a shell command when they apply:',
        '- `/plugin/skills/review/SKILL.md`: Reviews.',
        '- `/home/.claude/skills/animate/SKILL.md`: animate',
      ].join('\n')
    );
    expect(resolveCodexSkillInstructions({ ...EXTENSIONS, skills: [] })).toBeNull();
  });

  test('a run says what it loaded, without the Claude plugins Codex cannot load', async () => {
    const codex = new FakeCodex();
    const entries: ChatEvent[] = [];
    await startCodexSession(
      {
        role: 'planner',
        cwd: createTempDir(),
        prompt: 'Plan it',
        model: 'gpt-6-astra',
        resume: null,
        defaultBranch: 'main',
        tools: createShinsaTools('planner', (name) => Promise.resolve(`${name} accepted.`)),
        pluginDir: '/plugin',
        onSession: () => undefined,
        onEntry: (entry) => entries.push(entry),
        extensions: EXTENSIONS,
      },
      { runtime: codex.runtime, requestTimeoutMs: 50, heartbeatMs: 5 }
    ).done;
    expect(entries[1]).toEqual({
      type: 'notice',
      notice: {
        kind: 'extensions',
        servers: EXTENSIONS.loaded.servers,
        skills: EXTENSIONS.loaded.skills,
        plugins: [],
      },
    });
    const thread = codex.requests('thread/start')[0] as {
      config: Record<string, unknown>;
      developerInstructions: string;
    };
    expect(thread.config['mcp_servers.files']).toMatchObject({ command: 'npx' });
    expect(thread.developerInstructions).toContain('/home/.claude/skills/animate/SKILL.md');
  });
});
