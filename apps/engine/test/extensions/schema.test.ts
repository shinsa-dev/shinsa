import { describe, expect, test } from 'bun:test';
import { Schema } from 'effect';
import {
  ClaudeConfig,
  ClaudeSettings,
  CodexConfig,
  ExtensionsFile,
  InstalledPlugins,
  McpEntry,
  StoredCredentials,
  TranscriptToolCall,
  UsageFileFields,
} from '../../src/extensions/schema.ts';

describe('reading what Shinsa and the agents’ tools wrote', () => {
  test('an optimizer and a server check with fields of the wrong shape keep their defaults', () => {
    const file = Schema.decodeUnknownSync(ExtensionsFile)({
      optimizer: { enabled: 'yes', days: 900, skills: 1 },
      statuses: { a: { state: 'failing', error: 3, checkedAt: 'x', tools: 'junk', tokens: 'x' } },
    });
    expect(file.optimizer).toEqual({ enabled: true, days: 14, skills: true });
    expect(file.statuses).toEqual({ a: { state: 'failing', error: null, checkedAt: null, tokens: null } });
  });

  test('a transcript tool call without a time has none', () => {
    const call = Schema.decodeUnknownSync(TranscriptToolCall)({ type: 'tool_call', at: 'now', tool: {} });
    expect(call.at).toBeNaN();
  });

  test('a plugin, a project or a sign-in of the wrong shape reads as empty', () => {
    expect(Schema.decodeUnknownSync(InstalledPlugins)({ plugins: { 'a@b': 'junk' } })).toEqual({
      plugins: { 'a@b': [] },
    });
    expect(Schema.decodeUnknownSync(ClaudeConfig)({ projects: { '/r': 'junk' } })).toEqual({
      projects: { '/r': {} },
    });
    expect(
      Schema.decodeUnknownSync(StoredCredentials)({
        client: { client_id: 'shinsa' },
        discovery: { authorizationServerUrl: 'https://auth.example' },
      })
    ).toEqual({
      client: { client_id: 'shinsa' },
      discovery: { authorizationServerUrl: 'https://auth.example' },
    });
    expect(Schema.decodeUnknownSync(StoredCredentials)({ client: 'x', discovery: {} })).toEqual({});
  });

  test('every field of the wrong shape is dropped, and the rest of the file is kept', () => {
    expect(
      Schema.decodeUnknownSync(ExtensionsFile)({
        servers: 'x',
        choices: { a: 'x', b: { enabled: 'x', scope: 'x' } },
        skills: { a: 'x' },
        plugins: { a: 'x' },
        statuses: { a: 'x' },
        optimizer: 'x',
        seen: { a: 'x' },
      })
    ).toEqual({ choices: { b: {} }, skills: {}, plugins: {}, statuses: {}, seen: {} });
    expect(
      Schema.decodeUnknownSync(ExtensionsFile)({
        choices: 'x',
        skills: 'x',
        plugins: 'x',
        statuses: 'x',
        seen: 'x',
      })
    ).toEqual({});
    expect(
      Schema.decodeUnknownSync(UsageFileFields)({
        files: { a: 'x' },
        servers: 'x',
        labels: 'x',
        skills: 'x',
        readAt: 'x',
        since: 'x',
      })
    ).toEqual({ files: {}, readAt: null, since: null });
    expect(Schema.decodeUnknownSync(UsageFileFields)({ files: 'x' })).toEqual({ readAt: null, since: null });
    expect(
      Schema.decodeUnknownSync(McpEntry)({
        url: 1,
        command: 1,
        args: 'x',
        env: 'x',
        cwd: 1,
        bearer_token_env_var: 1,
        bearerTokenEnv: 1,
      })
    ).toEqual({});
    expect(
      Schema.decodeUnknownSync(TranscriptToolCall)({ type: 'tool_call', at: 1, tool: { args: 'x' } })
    ).toEqual({ type: 'tool_call', at: 1, tool: {} });
    expect(Schema.decodeUnknownSync(ClaudeSettings)({ enabledPlugins: 'x' })).toEqual({});
    expect(Schema.decodeUnknownSync(ClaudeConfig)({ projects: 'x' })).toEqual({});
    expect(
      Schema.decodeUnknownSync(ClaudeConfig)({
        projects: { '/r': { disabledMcpServers: 'x', disabledMcpjsonServers: 'x' } },
      })
    ).toEqual({ projects: { '/r': {} } });
    expect(Schema.decodeUnknownSync(CodexConfig)({ mcp_servers: 'x' })).toEqual({});
    expect(
      Schema.decodeUnknownSync(StoredCredentials)({
        clientRedirect: 1,
        tokens: 'x',
        savedAt: 'x',
        verifier: 1,
      })
    ).toEqual({});
  });
});
