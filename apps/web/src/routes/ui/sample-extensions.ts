import type { ExtensionsSnapshot, McpServerSummary, SkillSummary } from '@shinsa/core';
import type { ExtensionPlaces } from '@/lib/extensions.ts';
import { DAY, MINUTE } from './samples.ts';

function createSampleServer(
  overrides: Partial<McpServerSummary> & { id: string; name: string },
  status: Partial<McpServerSummary['status']> = {}
): McpServerSummary {
  return {
    source: 'shinsa',
    origin: 'Shinsa',
    transport: 'http',
    command: null,
    args: [],
    url: `https://mcp.${overrides.name}.app/mcp`,
    envKeys: [],
    headerKeys: [],
    enabled: true,
    scope: { kind: 'everywhere' },
    editable: true,
    shadowedBy: null,
    signedIn: false,
    plugin: null,
    definedIn: [],
    lastUsedAt: null,
    deferred: false,
    ...overrides,
    status: { state: 'unchecked', error: null, checkedAt: null, tools: [], tokens: null, ...status },
  };
}

function createSampleSkill(
  overrides: Partial<SkillSummary> & { id: string; name: string; description: string }
): SkillSummary {
  return {
    source: 'user',
    origin: '~/.claude/skills',
    plugin: null,
    repoPath: null,
    enabled: true,
    tokens: 600,
    lastUsedAt: null,
    deferred: false,
    ...overrides,
  };
}

export const SAMPLE_PLACES: ExtensionPlaces = {
  projects: [{ id: 'superwall', name: 'Superwall', color: 'blue' }],
  repos: [{ path: '/Users/me/code/paywall-next', name: 'paywall-next' }],
};

export function createSampleExtensions(now: number): ExtensionsSnapshot {
  return {
    servers: [
      createSampleServer(
        { id: 'linear', name: 'linear', signedIn: true },
        {
          state: 'connected',
          checkedAt: now - 2 * MINUTE,
          tokens: 4_200,
          tools: [
            { name: 'list_issues', description: 'List issues in a team, filtered by state or assignee.' },
            { name: 'create_issue', description: 'Create an issue with a title, description and labels.' },
            { name: 'search_documents', description: null },
          ],
        }
      ),
      createSampleServer(
        {
          id: 'sentry',
          name: 'sentry',
          source: 'claude',
          origin: '~/.claude.json',
          editable: false,
          lastUsedAt: now - 2 * DAY,
        },
        { state: 'needs_sign_in', checkedAt: now - 2 * MINUTE, error: 'Sentry asks you to sign in.' }
      ),
      createSampleServer(
        {
          id: 'maple',
          name: 'maple',
          source: 'claude_project',
          origin: '~/.claude.json · ~/code/paywall-next',
          editable: false,
          lastUsedAt: now - 31 * DAY,
          definedIn: [
            {
              id: 'maple',
              source: 'claude_project',
              origin: '~/.claude.json · ~/code/paywall-next',
              scope: { kind: 'repo', path: '/Users/me/code/paywall-next' },
              enabled: true,
            },
            {
              id: 'maple-user',
              source: 'claude',
              origin: '~/.claude.json',
              scope: { kind: 'everywhere' },
              enabled: true,
            },
            {
              id: 'maple-codex',
              source: 'codex',
              origin: '~/.codex/config.toml',
              scope: { kind: 'everywhere' },
              enabled: true,
            },
          ],
        },
        {
          state: 'connected',
          checkedAt: now - 2 * MINUTE,
          tokens: 21_000,
          tools: [{ name: 'search_traces', description: 'Find traces by service and duration.' }],
        }
      ),
      createSampleServer(
        {
          id: 'github',
          name: 'github',
          source: 'project',
          origin: 'paywall-next/.mcp.json',
          transport: 'stdio',
          url: null,
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-github'],
          envKeys: ['GITHUB_TOKEN'],
          editable: false,
          scope: { kind: 'repo', path: '/Users/me/code/paywall-next' },
        },
        {
          state: 'failing',
          checkedAt: now - 2 * MINUTE,
          error: 'The command exited with code 1: GITHUB_TOKEN is not set.',
        }
      ),
      createSampleServer({
        id: 'figma',
        name: 'figma',
        source: 'codex',
        origin: '~/.codex/config.toml',
        editable: false,
        scope: { kind: 'project', project: 'superwall' },
      }),
      createSampleServer(
        {
          id: 'postgres',
          name: 'postgres',
          source: 'claude',
          origin: '~/.claude.json',
          editable: false,
          enabled: false,
        },
        { tokens: 1_800 }
      ),
      createSampleServer(
        {
          id: 'linear-claude',
          name: 'linear',
          source: 'claude',
          origin: '~/.claude.json',
          editable: false,
          shadowedBy: 'linear',
        },
        { tokens: 3_900 }
      ),
      createSampleServer(
        {
          id: 'vercel',
          name: 'vercel',
          source: 'plugin',
          origin: 'vercel plugin',
          plugin: 'vercel',
          editable: false,
        },
        { tokens: 2_600 }
      ),
    ],
    plugins: [
      {
        id: 'vercel',
        name: 'vercel',
        origin: '~/.claude/plugins/vercel',
        enabled: false,
        skills: 12,
        agents: 2,
        commands: 3,
        servers: 1,
        hooks: true,
        tokens: 6_400,
      },
      {
        id: 'stripe',
        name: 'stripe',
        origin: '~/.claude/plugins/stripe',
        enabled: true,
        skills: 4,
        agents: 0,
        commands: 1,
        servers: 0,
        hooks: false,
        tokens: 2_100,
      },
    ],
    skills: [
      createSampleSkill({
        id: 'shinsa-review',
        name: 'review',
        description: 'How to review a change: scope the diff, prove every finding.',
        source: 'shinsa',
        origin: 'Shinsa',
        tokens: 900,
      }),
      createSampleSkill({
        id: 'shinsa-evidence',
        name: 'evidence',
        description: 'Attach screenshots and logs that show the change works.',
        source: 'shinsa',
        origin: 'Shinsa',
        tokens: 450,
      }),
      ...['design', 'copy', 'conventions', 'animate', 'motion', 'video', 'superwall'].map((name, index) =>
        createSampleSkill({
          id: `user-${name}`,
          name,
          description: `The ${name} skill from your own Claude Code setup, with its rules and examples.`,
          enabled: index % 3 !== 2,
          tokens: 500 + index * 350,
        })
      ),
      createSampleSkill({
        id: 'stripe-best-practices',
        name: 'best-practices',
        description: 'Stripe integration rules for payments, webhooks and Connect.',
        source: 'plugin',
        origin: 'stripe plugin',
        plugin: 'stripe',
        tokens: 1_200,
      }),
      createSampleSkill({
        id: 'vercel-deploy',
        name: 'deploy',
        description: 'Deploy to Vercel and read the build logs.',
        source: 'plugin',
        origin: 'vercel plugin',
        plugin: 'vercel',
      }),
      createSampleSkill({
        id: 'paywall-next-tokens',
        name: 'design-tokens',
        description: 'Which design tokens paywall-next uses and where they live.',
        source: 'project',
        origin: 'paywall-next/.claude/skills',
        repoPath: '/Users/me/code/paywall-next',
        tokens: 700,
      }),
      createSampleSkill({
        id: 'codex-pdf',
        name: 'pdf',
        description: 'Read and fill PDF files.',
        source: 'codex',
        origin: '~/.codex/skills',
        enabled: false,
        tokens: 1_100,
      }),
    ],
    problems: ['~/.codex/config.toml could not be read: line 12 is not valid TOML.'],
    optimizer: { enabled: false, days: 14, skills: false },
    usage: { readAt: now - MINUTE, since: now - 90 * DAY },
  };
}
