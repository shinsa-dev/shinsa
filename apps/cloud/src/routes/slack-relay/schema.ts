import { Schema } from 'effect';

export const REFUSED_BLOCK_CODES = new Set(['invalid_blocks', 'invalid_blocks_format']);

export const STATUS_UNAVAILABLE_CODES = new Set(['not_authorized', 'feature_disabled']);

export const SETTLED_REACTION_CODES = new Set(['no_reaction', 'already_reacted']);

export const Posted = Schema.Struct({ ts: Schema.optional(Schema.String) });
