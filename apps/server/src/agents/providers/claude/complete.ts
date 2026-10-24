import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { CompletionRequest, StructuredRequest } from '../types.ts';
import { CLAUDE_RUNTIME, type ClaudeRuntime, resolveClaudeProcess } from './sdk.ts';

const COMPLETION_TIMEOUT_MS = 45_000;

const STRUCTURED_TIMEOUT_MS = 20_000;

export async function requestClaudeCompletion(
  request: CompletionRequest,
  runtime: ClaudeRuntime = CLAUDE_RUNTIME,
  timeoutMs = COMPLETION_TIMEOUT_MS
): Promise<string | null> {
  const process = await resolveClaudeProcess(runtime.resolveExecutable);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const session = runtime.runQuery({
      prompt: request.prompt,
      options: {
        model: request.model,
        maxTurns: 1,
        thinking: { type: 'disabled' },
        tools: [],
        settingSources: [],
        settings: { fastMode: request.fastMode === true },
        systemPrompt: request.system,
        abortController: controller,
        ...process.options,
      },
    });
    for await (const message of session) {
      if (message.type === 'result' && message.subtype === 'success') return message.result.trim();
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function readStructuredOutput(message: SDKMessage): unknown {
  if (message.type === 'result')
    return message.subtype === 'success' ? (message.structured_output ?? null) : null;
  if (message.type !== 'assistant') return null;
  for (const block of message.message.content) {
    if (block.type === 'tool_use' && block.name === 'StructuredOutput') return block.input ?? null;
  }
  return null;
}

export async function requestClaudeStructured(
  request: StructuredRequest,
  runtime: ClaudeRuntime = CLAUDE_RUNTIME
): Promise<unknown> {
  const process = await resolveClaudeProcess(runtime.resolveExecutable);
  const timeoutMs = request.timeoutMs ?? STRUCTURED_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const session = runtime.runQuery({
    prompt: request.prompt,
    options: {
      model: request.model,
      tools: [],
      settingSources: [],
      settings: { fastMode: request.fastMode === true },
      systemPrompt: request.system,
      effort: 'low',
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      outputFormat: { type: 'json_schema', schema: request.schema as unknown as Record<string, unknown> },
      abortController: controller,
      ...process.options,
    },
  });
  try {
    for await (const message of session) {
      const output = readStructuredOutput(message);
      if (output !== null) return output;
    }
    return null;
  } catch (error) {
    if (controller.signal.aborted) throw new Error(`Claude did not answer within ${timeoutMs} ms.`);
    throw error;
  } finally {
    clearTimeout(timer);
    session.close();
  }
}
