import { query } from '@anthropic-ai/claude-agent-sdk';
import { describeError, log } from '../../log/index.ts';
import { type QueryFn, resolveClaudeProcess } from '../claude/sdk.ts';

export type QuickJson = <T>(system: string, prompt: string) => Promise<T | null>;

const QUICK_MODEL = 'haiku';

const QUICK_TIMEOUT_MS = 45_000;

export async function requestQuickText(
  system: string,
  prompt: string,
  runQuery: QueryFn = query,
  timeoutMs = QUICK_TIMEOUT_MS
): Promise<string | null> {
  if (Bun.env.SHINSA_QUICK === 'off') return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const session = runQuery({
      prompt,
      options: {
        model: QUICK_MODEL,
        maxTurns: 1,
        thinking: { type: 'disabled' },
        tools: [],
        settingSources: [],
        systemPrompt: system,
        abortController: controller,
        ...resolveClaudeProcess(),
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

export function parseJsonObject<T>(text: string | null): T | null {
  const match = text ? /\{[\s\S]*\}/.exec(text) : null;
  if (!match) return null;
  try {
    return JSON.parse(match[0]) as T;
  } catch {
    return null;
  }
}

export async function requestQuickJson<T>(system: string, prompt: string, runQuery: QueryFn = query) {
  try {
    const text = await requestQuickText(
      `${system}\nAnswer with one JSON object and nothing else.`,
      prompt,
      runQuery
    );
    return parseJsonObject<T>(text);
  } catch (error) {
    log.warn('[Quick] The model call failed; using the fallback', { error: describeError(error) });
    return null;
  }
}
