import { describe, expect, test } from 'bun:test';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  hasConversation,
  resolveClaudeConfigDir,
  resolveClaudeProjectName,
  resolveClaudeSessionStatus,
} from '../../../../src/agents/providers/claude/artifacts.ts';
import { createTempDir } from '../../../helpers/index.ts';

const CWD = '/Users/me/.config/shinsa/data/worktrees/app/fix-login';

function claudeHome(env: Record<string, string> = {}) {
  const home = createTempDir();
  const projects = join(resolveClaudeConfigDir(CWD, env, home), 'projects');
  const project = join(projects, resolveClaudeProjectName(CWD));
  mkdirSync(project, { recursive: true });
  return { home, projects, project, env };
}

const META = `${JSON.stringify({ type: 'summary', summary: 'x' })}\n${JSON.stringify({ type: 'system' })}\n`;

describe('resolveClaudeSessionStatus', () => {
  test('a session file with a conversation can be resumed', () => {
    const { home, project } = claudeHome();
    writeFileSync(join(project, 'sess-1.jsonl'), `${META}${JSON.stringify({ type: 'assistant' })}\n`);
    expect(resolveClaudeSessionStatus({ cwd: CWD, sessionId: 'sess-1', env: {}, home })).toBe('present');
  });

  test('a file with only metadata lines is empty, so Claude could neither resume nor recreate it', () => {
    const { home, project } = claudeHome();
    writeFileSync(join(project, 'sess-1.jsonl'), META);
    expect(resolveClaudeSessionStatus({ cwd: CWD, sessionId: 'sess-1', env: {}, home })).toBe('empty');
  });

  test('a session copied under another project still counts, if any copy holds the conversation', () => {
    const { home, projects, project } = claudeHome();
    writeFileSync(join(project, 'sess-1.jsonl'), META);
    mkdirSync(join(projects, 'elsewhere'));
    writeFileSync(join(projects, 'elsewhere', 'sess-1.jsonl'), JSON.stringify({ type: 'user' }));
    writeFileSync(join(projects, 'stray-file'), 'not a project');
    expect(resolveClaudeSessionStatus({ cwd: CWD, sessionId: 'sess-1', env: {}, home })).toBe('present');
  });

  test('a session gone from a project Claude has used is missing', () => {
    const { home } = claudeHome();
    expect(resolveClaudeSessionStatus({ cwd: CWD, sessionId: 'sess-9', env: {}, home })).toBe('missing');
  });

  test('without the project folder, or with no Claude home, nothing is assumed', () => {
    const { home } = claudeHome();
    expect(resolveClaudeSessionStatus({ cwd: '/other/place', sessionId: 'sess-9', env: {}, home })).toBe(
      'unknown'
    );
    expect(
      resolveClaudeSessionStatus({ cwd: CWD, sessionId: 'sess-9', env: {}, home: createTempDir() })
    ).toBe('unknown');
  });

  test('a session id that is not a plain token is never looked up', () => {
    const { home } = claudeHome();
    expect(resolveClaudeSessionStatus({ cwd: CWD, sessionId: '../escape', env: {}, home })).toBe('unknown');
  });

  test('CLAUDE_CONFIG_DIR moves the Claude home, relative to the worktree when it is relative', () => {
    const config = createTempDir();
    const { home, project } = claudeHome({ CLAUDE_CONFIG_DIR: config });
    writeFileSync(join(project, 'sess-1.jsonl'), JSON.stringify({ type: 'user' }));
    expect(
      resolveClaudeSessionStatus({ cwd: CWD, sessionId: 'sess-1', env: { CLAUDE_CONFIG_DIR: config }, home })
    ).toBe('present');
    expect(resolveClaudeSessionStatus({ cwd: CWD, sessionId: 'sess-1', env: {}, home })).toBe('unknown');
    expect(resolveClaudeConfigDir('/w', { CLAUDE_CONFIG_DIR: ' rel ' }, '/h')).toBe('/w/rel');
    expect(resolveClaudeConfigDir('/w', { CLAUDE_CONFIG_DIR: '  ' }, '/h')).toBe('/h/.claude');
  });

  test('an unreadable session file leaves the resume to the CLI', () => {
    const { home, project } = claudeHome();
    const path = join(project, 'sess-1.jsonl');
    writeFileSync(path, META);
    chmodSync(path, 0o000);
    try {
      expect(resolveClaudeSessionStatus({ cwd: CWD, sessionId: 'sess-1', env: {}, home })).toBe('unknown');
    } finally {
      chmodSync(path, 0o644);
    }
  });
});

describe('hasConversation', () => {
  test('reads in chunks, across a line split by a chunk, and a last line without a newline', () => {
    const dir = createTempDir();
    const long = join(dir, 'long.jsonl');
    writeFileSync(
      long,
      `${JSON.stringify({ type: 'summary', pad: 'x'.repeat(70_000) })}\n${JSON.stringify({ type: 'user' })}\n`
    );
    expect(hasConversation(long)).toBe(true);
    const tail = join(dir, 'tail.jsonl');
    writeFileSync(tail, `${META}${JSON.stringify({ type: 'assistant' })}`);
    expect(hasConversation(tail)).toBe(true);
    const torn = join(dir, 'torn.jsonl');
    writeFileSync(torn, `${META}{"type":"us`);
    expect(hasConversation(torn)).toBe(false);
    const blank = join(dir, 'blank.jsonl');
    writeFileSync(blank, '');
    expect(hasConversation(blank)).toBe(false);
  });
});
