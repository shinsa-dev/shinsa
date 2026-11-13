import type { SlackChannel } from '@shinsa/core';
import { Schema } from 'effect';
import type { PrivateMemberships } from '../../slack/schema.ts';

export const REFUSED_BLOCK_CODES = new Set([
  'invalid_blocks',
  'invalid_blocks_format',
  'msg_blocks_too_long',
]);

export const STATUS_UNAVAILABLE_CODES = new Set(['not_authorized', 'feature_disabled']);

export const SETTLED_REACTION_CODES = new Set(['no_reaction', 'already_reacted']);

export const Posted = Schema.Struct({ ts: Schema.optional(Schema.String) });

export interface RelayThread {
  readonly teamId: string;
  readonly channelId: string;
  readonly threadTs: string;
}

export interface ListedChannel {
  readonly channel: SlackChannel;
  readonly unsure: string | null;
}

export const NO_MEMBERSHIPS: PrivateMemberships = { member: new Set(), failed: null };
