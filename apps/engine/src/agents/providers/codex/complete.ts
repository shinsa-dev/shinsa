import { tmpdir } from 'node:os';
import type { CompletionRequest, JsonSchema, StructuredRequest } from '../types.ts';
import { CodexClient, readRecord } from './client.ts';
import { CODEX_RUNTIME, type CodexRuntime, FAST_TIER } from './session.ts';

const COMPLETION_TIMEOUT_MS = 45_000;

const STRUCTURED_TIMEOUT_MS = 20_000;

type Params = Record<string, unknown>;

class CodexSetupError extends Error {
  override name = 'CodexSetupError';
}

function readTurnError(params: Params) {
  const message = readRecord(readRecord(params.turn).error).message;
  return typeof message === 'string' && message ? message : 'Codex stopped with an error.';
}

type Answer = { text: string | null } | { error: Error };

async function requestAnswer(
  runtime: CodexRuntime,
  request: CompletionRequest,
  schema: JsonSchema | null,
  timeoutMs: number
) {
  const executable = await runtime.resolveExecutable();
  if (!executable.ok) throw new CodexSetupError(executable.message);
  const client = new CodexClient({ path: executable.path, cwd: tmpdir(), env: runtime.env });
  const answer = Promise.withResolvers<Answer>();
  let threadId: string | null = null;
  let text: string | null = null;
  const timer = setTimeout(() => {
    answer.resolve({ error: new Error(`Codex did not answer within ${timeoutMs} ms.`) });
    client.close();
  }, timeoutMs);
  client.onExit((message) => answer.resolve({ error: new Error(message) }));
  client.onRequest((method) => Promise.reject(new Error(`A quick call does not answer ${method}.`)));
  client.onNotification((method, params) => {
    if (params.threadId !== threadId) return;
    const item = readRecord(params.item);
    if (method === 'item/completed' && item.type === 'agentMessage' && typeof item.text === 'string') {
      text = item.text;
    }
    if (method !== 'turn/completed') return;
    if (readRecord(params.turn).status === 'completed') answer.resolve({ text: text?.trim() || null });
    else answer.resolve({ error: new Error(readTurnError(params)) });
  });
  try {
    await client.initialize();
    const thread = await client.request('thread/start', {
      model: request.model,
      cwd: tmpdir(),
      approvalPolicy: 'never',
      sandbox: 'read-only',
      serviceTier: request.fastMode ? FAST_TIER : null,
      ephemeral: true,
      developerInstructions: request.system,
    });
    threadId = String(readRecord(thread.thread).id);
    await client.request('turn/start', {
      threadId,
      input: [{ type: 'text', text: request.prompt, text_elements: [] }],
      effort: 'low',
      ...(schema ? { outputSchema: schema } : {}),
    });
    const result = await answer.promise;
    if ('error' in result) throw result.error;
    return result.text;
  } finally {
    clearTimeout(timer);
    client.close();
  }
}

function parseObject(text: string | null) {
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

export function requestCodexCompletion(request: CompletionRequest, runtime: CodexRuntime = CODEX_RUNTIME) {
  return requestAnswer(runtime, request, null, COMPLETION_TIMEOUT_MS);
}

export async function requestCodexStructured(
  request: StructuredRequest,
  runtime: CodexRuntime = CODEX_RUNTIME
) {
  const text = await requestAnswer(
    runtime,
    request,
    request.schema,
    request.timeoutMs ?? STRUCTURED_TIMEOUT_MS
  );
  return parseObject(text);
}
