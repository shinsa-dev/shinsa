import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

if (process.env.FAKE_MCP_REGISTRY) {
  writeFileSync(join(process.env.FAKE_MCP_REGISTRY, String(process.pid)), process.argv.slice(2).join(' '));
}

if (process.env.FAKE_MCP_FAIL) {
  process.stderr.write(`${process.env.FAKE_MCP_FAIL}\n`);
  process.exit(3);
}

const server = new McpServer({ name: 'fake-stdio', version: '1.0.0' });
server.registerTool('echo', { description: 'Says back what it gets.' }, () => ({
  content: [{ type: 'text', text: process.env.FAKE_MCP_GREETING ?? 'hello' }],
}));
server.registerTool('refuse', { description: 'Always fails.' }, () => ({
  content: [{ type: 'text', text: 'No, not today.' }],
  isError: true,
}));
server.registerTool('silent', { description: 'Fails without a word.' }, () => ({
  content: [],
  isError: true,
}));
server.registerTool('picture', { description: 'Answers with a picture.' }, () => ({
  content: [
    { type: 'text', text: 'Here it is:' },
    { type: 'image', data: 'AAAA', mimeType: 'image/png' },
  ],
}));
await server.connect(new StdioServerTransport());
