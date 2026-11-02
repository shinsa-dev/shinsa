import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';
import { resolveTokenEstimate } from '@shinsa/core';
import { Predicate } from 'effect';
import { describeError } from '../log/redact.ts';
import { TOOL_DESCRIPTION_LIMIT } from './schema.ts';

const UNAUTHORIZED = /\b401\b|unauthori[sz]ed/i;

export function isUnauthorized(error: unknown) {
  if (error instanceof UnauthorizedError) return true;
  if (Predicate.hasProperty(error, 'code') && error.code === 401) return true;
  return UNAUTHORIZED.test(describeError(error));
}

function clipToolDescription(text: string | undefined) {
  if (!text) return null;
  return text.length > TOOL_DESCRIPTION_LIMIT ? `${text.slice(0, TOOL_DESCRIPTION_LIMIT - 1)}…` : text;
}

export function listToolInfo(tools: readonly { name: string; description?: string | undefined }[]) {
  return tools.map((tool) => ({ name: tool.name, description: clipToolDescription(tool.description) }));
}

export function sumToolTokens(tools: readonly unknown[]) {
  return tools.reduce<number>((total, tool) => total + resolveTokenEstimate(JSON.stringify(tool)), 0);
}
