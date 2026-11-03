import type { ShinsaCommand, ShinsaEvent, ShinsaState } from '@shinsa/core';
import { Duration, Effect, Schema } from 'effect';
import type { JsonSchema } from '../agents/providers/index.ts';
import type { SecretStore } from '../secrets/index.ts';

export interface WebhookRequest {
  method: string;
  path: string;
  query: string;
  headers: Readonly<Record<string, string>>;
  bodyText: string;
}

export const WebhookBodyText = Schema.fromJsonString(Schema.Unknown);

export const WebhookOutcome = Schema.Literals([
  'accepted',
  'duplicate',
  'prompt_refused',
  'not_found',
  'disabled',
  'rejected_signature',
  'rate_limited',
  'body_too_large',
  'error',
]);
export type WebhookOutcome = typeof WebhookOutcome.Type;

export interface WebhookReceiverOptions {
  now?: () => number;
  newId?: () => string;
}

export interface ScheduleToolCall {
  runId: string;
  attemptId: string;
  state: () => ShinsaState;
  dispatch: (command: ShinsaCommand) => Promise<ShinsaEvent[]>;
}

export interface ScheduleToolContext {
  secrets: SecretStore;
  baseUrl: () => string;
  hookUrl: (scheduleId: string, token: string) => string | null;
  timeZone: string;
  now: () => number;
}

const WatchLine = Schema.optionalKey(Schema.String.pipe(Schema.catchDecoding(() => Effect.succeedNone)));

export const WatchAnswer = Schema.Struct({ name: WatchLine, text: WatchLine });

export interface WatchWording {
  name: string | null;
  text: string | null;
}

export class WatchWordingFailed extends Schema.TaggedError<
  WatchWordingFailed,
  { readonly brand: unique symbol }
>()('WatchWordingFailed', { message: Schema.String }) {}

export type WatchWriter = (server: string, data: string) => Promise<WatchWording>;

export const WEBHOOK_ROUTE_PREFIX = '/api/hooks';

export const WEBHOOK_MAX_BODY_BYTES = 1024 * 1024;

export const WEBHOOK_RATE_LIMIT_PER_MINUTE = 60;

const RATE_WINDOW = Duration.minutes(1);

export const RATE_WINDOW_MS = Duration.toMillis(RATE_WINDOW);

export const WEBHOOK_PATH = /^\/api\/hooks\/([^/]+)\/([^/]+)$/;

export const PROMPT_TOO_LONG = 'The filled-in prompt is too long.';

export const PROMPT_EMPTY = 'The filled-in prompt is empty.';

export const FRAME_ID_BYTES = 6;

export const CREDENTIAL_NAME =
  /^(authorization|proxy-authorization|cookie|set-cookie)$|token|secret|signature|key|password|auth|credential|hmac|jwt|assertion/i;

export const REDACTED = '[redacted]';

export const PLACEHOLDER = /\{\{([^{}]*)\}\}/g;

export const MENTION = /[\p{Sc}@]|(?<=^|\s)\/(?=[^\s/]+(?:\s|$))|shinsa(?=:)|webhook(?=-data)/giu;

export const WORD_JOINER = '\u2060';

export const FORM_CONTENT_TYPE = 'application/x-www-form-urlencoded';

export const RECENT_RUNS = 5;

export const WATCH_TEXT_LIMIT = 200;

export const WATCH_SYSTEM = [
  'You word one suggested automation for Shinsa, a control plane for coding agents.',
  'A project just started using an integration: an MCP server that holds data, such as a Slack channel, an error tracker or an analytics tool.',
  'Shinsa will offer the human a watch: every hour an agent reads the integration and files a task for each new report in it.',
  'Write `text`, the one sentence that tells the agent what counts as a report, starting with “File a task for each new”, naming the kind of report and where it lives, for example “File a task for each new bug in #feedback.” or “File a task for each new error in Maple.”',
  'Write `name`, a short sentence-case name of at most six words, such as “Bugs in #feedback”.',
  'Use only what the integration says it holds. Plain words, no em dashes, no quotes around the sentence.',
].join('\n');

export const WATCH_SCHEMA: JsonSchema = {
  type: 'object',
  properties: { name: { type: 'string' }, text: { type: 'string' } },
  required: ['name', 'text'],
  additionalProperties: false,
};
