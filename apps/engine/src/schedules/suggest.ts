import { SCHEDULE_LIMITS } from '@shinsa/core';
import type { JsonSchema } from '../agents/providers/index.ts';
import type { QuickJson } from '../agents/quick/index.ts';

export interface WatchWording {
  name: string | null;
  text: string | null;
}

export type WatchWriter = (server: string, data: string) => Promise<WatchWording>;

const TEXT_LIMIT = 200;

const SYSTEM = [
  'You word one suggested automation for Shinsa, a control plane for coding agents.',
  'A project just started using an integration: an MCP server that holds data, such as a Slack channel, an error tracker or an analytics tool.',
  'Shinsa will offer the human a watch: every hour an agent reads the integration and files a task for each new report in it.',
  'Write `text`, the one sentence that tells the agent what counts as a report, starting with “File a task for each new”, naming the kind of report and where it lives, for example “File a task for each new bug in #feedback.” or “File a task for each new error in Maple.”',
  'Write `name`, a short sentence-case name of at most six words, such as “Bugs in #feedback”.',
  'Use only what the integration says it holds. Plain words, no em dashes, no quotes around the sentence.',
].join('\n');

const SCHEMA: JsonSchema = {
  type: 'object',
  properties: { name: { type: 'string' }, text: { type: 'string' } },
  required: ['name', 'text'],
  additionalProperties: false,
};

function readLine(value: unknown, max: number) {
  if (typeof value !== 'string') return null;
  const line = value.trim().split('\n', 1)[0]?.trim() ?? '';
  return line.length > 0 && line.length <= max ? line : null;
}

export function describeWatchPrompt(server: string, data: string) {
  return [`Integration: ${server}`, `What it holds: ${data}`].join('\n');
}

export function createWatchWriter(ask: QuickJson): WatchWriter {
  return async (server, data) => {
    const answer = await ask<{ name?: unknown; text?: unknown }>(
      SYSTEM,
      describeWatchPrompt(server, data),
      SCHEMA
    );
    return {
      name: readLine(answer?.name, SCHEDULE_LIMITS.name),
      text: readLine(answer?.text, TEXT_LIMIT),
    };
  };
}
