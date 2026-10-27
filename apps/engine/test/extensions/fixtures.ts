import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

export interface FakeMachine {
  userHome: string;
  claudeDir: string;
  claudeConfig: string;
  codexHome: string;
  pluginRoot: string;
  repo: string;
  shinsaHome: string;
  pluginDir: string;
  env: Record<string, string>;
}

export function writeFile(path: string, text: string) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

export function writeSkill(dir: string, name: string, description: string) {
  writeFile(
    join(dir, name, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`
  );
}

export function createFakeMachine(): FakeMachine {
  const userHome = mkdtempSync(join(tmpdir(), 'shinsa-machine-'));
  const claudeDir = join(userHome, '.claude');
  const claudeConfig = join(claudeDir, '.claude.json');
  const codexHome = join(userHome, '.codex');
  const pluginRoot = join(claudeDir, 'plugins', 'cache', 'market', 'docs', '1.0.0');
  const repo = join(userHome, 'code', 'app');
  const shinsaHome = join(userHome, '.config', 'shinsa');
  const pluginDir = join(userHome, 'shinsa-plugin');

  writeFile(
    claudeConfig,
    JSON.stringify({
      mcpServers: {
        linear: { type: 'http', url: 'https://mcp.linear.example/mcp', headers: { 'X-Key': 'secret' } },
        files: { command: 'npx', args: ['files-mcp'], env: { ROOT: `\${HOME}` } },
        broken: { type: 'http' },
      },
      projects: {
        [repo]: { mcpServers: { local: { type: 'http', url: 'http://127.0.0.1:7000/mcp' } } },
        '/elsewhere': 'not an object',
      },
    })
  );
  writeFile(
    join(repo, '.mcp.json'),
    JSON.stringify({ mcpServers: { repo_tools: { command: 'node', args: ['tools.js'] } } })
  );
  writeFile(
    join(codexHome, 'config.toml'),
    [
      'model = "gpt-6"',
      '[mcp_servers.maple]',
      'url = "https://maple.example/mcp"',
      'http_headers = { Authorization = "Bearer x" }',
      '[mcp_servers.kampala]',
      'command = "kampala"',
      'args = ["mcp"]',
      'cwd = "/tmp"',
      'enabled = false',
    ].join('\n')
  );
  writeFile(
    join(claudeDir, 'settings.json'),
    JSON.stringify({ enabledPlugins: { 'docs@market': true, 'off@market': false, 'gone@market': true } })
  );
  writeFile(
    join(claudeDir, 'plugins', 'installed_plugins.json'),
    JSON.stringify({
      version: 2,
      plugins: {
        'docs@market': [{ scope: 'user', installPath: pluginRoot }],
        'off@market': [{ scope: 'user', installPath: pluginRoot }],
        'gone@market': [{ scope: 'user', installPath: join(userHome, 'missing') }, 'junk'],
      },
    })
  );
  writeFile(
    join(pluginRoot, '.mcp.json'),
    JSON.stringify({
      mcpServers: {
        context: {
          command: `\${CLAUDE_PLUGIN_ROOT}/bin/server`,
          args: ['--root', `\${CLAUDE_PLUGIN_ROOT}`],
          env: { DIR: `\${CLAUDE_PLUGIN_ROOT}` },
        },
      },
    })
  );
  writeSkill(join(pluginRoot, 'skills'), 'lookup-docs', 'Looks up library docs.');
  writeFile(
    join(pluginRoot, 'agents', 'librarian.md'),
    '---\nname: librarian\ndescription: Finds the right docs page.\n---\n'
  );
  writeFile(join(pluginRoot, 'commands', 'docs.md'), '---\ndescription: Opens the docs.\n---\n');
  writeFile(join(pluginRoot, 'commands', 'notes.txt'), 'not a command');
  writeFile(join(pluginRoot, 'hooks', 'hooks.json'), '{}');
  writeSkill(join(claudeDir, 'skills'), 'animate', 'Builds an animation.');
  writeSkill(join(repo, '.claude', 'skills'), 'conventions', 'The repository’s code conventions.');
  writeSkill(join(codexHome, 'skills'), 'release', 'Cuts a release.');
  mkdirSync(join(codexHome, 'skills', '.system'), { recursive: true });
  writeSkill(join(pluginDir, 'skills'), 'review', 'How to review a change.');
  mkdirSync(shinsaHome, { recursive: true });

  return {
    userHome,
    claudeDir,
    claudeConfig,
    codexHome,
    pluginRoot,
    repo,
    shinsaHome,
    pluginDir,
    env: { HOME: userHome, CLAUDE_CONFIG_DIR: claudeDir, CODEX_HOME: codexHome, LINEAR_TOKEN: 'lin-123' },
  };
}

export function serializeClaudeToolUse(name: string, at: number, input: Record<string, unknown> = {}) {
  return JSON.stringify({
    type: 'assistant',
    message: {
      role: 'assistant',
      content: [{ type: 'tool_use', id: `toolu_${at}`, name, input }],
    },
    timestamp: new Date(at).toISOString(),
  });
}

export function serializeShinsaToolCall(tool: Record<string, unknown>, at: number) {
  return JSON.stringify({ v: 1, id: `e${at}`, at, type: 'tool_call', callId: `c${at}`, tool });
}
