import type { SDKResultMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import type { PendingPrompt, PromptLedger } from './schema.ts';

export function createUserMessage(text: string, id: string): SDKUserMessage {
  return {
    type: 'user',
    message: { role: 'user', content: text },
    parent_tool_use_id: null,
    session_id: '',
    uuid: id as SDKUserMessage['uuid'],
  };
}

export function listEchoedPromptIds(message: SDKResultMessage) {
  const ids = Array.isArray(message.user_message_uuids)
    ? message.user_message_uuids.filter((id) => typeof id === 'string')
    : [];
  if (ids.length > 0) return ids;
  return typeof message.user_message_uuid === 'string' && message.user_message_uuid
    ? [message.user_message_uuid]
    : [];
}

export function isOtherOrigin(message: SDKResultMessage) {
  return message.origin !== undefined && message.origin.kind !== 'human';
}

export function takeAnsweredPrompts(
  ledger: PromptLedger,
  ids: readonly string[],
  endedEarly: boolean
): [readonly PendingPrompt[], PromptLedger] {
  if (ids.length > 0) {
    const answered = ledger.pending.filter((prompt) => ids.includes(prompt.id));
    const pending = ledger.pending.filter((prompt) => !ids.includes(prompt.id));
    return [answered, { pending, echoes: true }];
  }
  const [head, ...rest] = ledger.pending;
  if (!head || (ledger.echoes && !endedEarly)) return [[], ledger];
  return [[head], { ...ledger, pending: rest }];
}

export function listUndeliveredSteers(ledger: PromptLedger) {
  return ledger.pending.filter((prompt) => prompt.steer).map((prompt) => prompt.text);
}
