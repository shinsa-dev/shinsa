import { describe, expect, test } from 'bun:test';
import { describeWatchdogGuide } from '../../src/prompts/watchdogs.ts';

const CLOUD = {
  server: 'Cloudflare',
  data: 'Workers Logs of the shinsa-cloud Worker',
  repoIds: [],
  addedBy: 'you' as const,
  addedAt: 0,
};

describe('the watchdog guide', () => {
  test('counts every server the agent has, with the data sources only as hints', () => {
    const guide = describeWatchdogGuide([CLOUD]);
    expect(guide).toContain('from any MCP server you have, not only the data sources below');
    expect(guide).toContain('`mcp_list`');
    expect(guide).toContain('`load_mcp_server`');
    expect(guide).toContain('A data source’s description is a hint, not a limit');
    expect(guide).toContain('- `Cloudflare`: Workers Logs of the shinsa-cloud Worker');
  });

  test('asks for a new server only after checking every one that could hold the data', () => {
    const guide = describeWatchdogGuide([]);
    expect(guide).toContain('check every server that could, with its own tools');
    expect(guide).toContain('Only when no server you have reaches the data, give a `source_request`');
    expect(guide).toContain('which servers you checked and why each cannot reach it');
    expect(guide).toContain('Shinsa refuses a suggestion of a server you already have');
    expect(guide).toContain('The project has no data sources for this repository yet.');
  });
});
