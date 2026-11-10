import { PROTOCOL_LIMITS, REPLY_OUTCOMES } from '@shinsa/core';
import { limitedText } from './fields.ts';

const L = PROTOCOL_LIMITS;

export const REPLY_SPEC = {
  type: 'object',
  description:
    'Required when this hand-over answers a message the human sent, and refused otherwise. The human reads it first, above the rest of the hand-over: what you did about their message, point by point, and what they do now.',
  properties: {
    headline: limitedText('What you did about their message, in one sentence.', L.replyHeadline),
    points: {
      type: 'array',
      description: 'Each thing they raised, in their order. At least one.',
      minItems: 1,
      maxItems: L.replyPoints,
      items: {
        type: 'object',
        properties: {
          ask: limitedText('What they asked or raised, in their words cut short.', L.replyAsk),
          outcome: {
            type: 'string',
            enum: [...REPLY_OUTCOMES],
            description:
              'done: you made the change. answered: it was a question and the note answers it. not_changed: you left it as it was, and the note says why.',
          },
          note: limitedText('Where it is now, the answer, or why you left it.', L.replyNote),
        },
        required: ['ask', 'outcome', 'note'],
      },
    },
    next: limitedText(
      'What they do now to see or try it, in markdown: numbered steps with the exact commands in ```bash run blocks and full links. Leave it out when there is nothing.',
      L.replyNext
    ),
  },
  required: ['headline', 'points'],
};

export const ACTIONS_SPEC = {
  type: 'array',
  description:
    'Rarely: only when this hand-over leaves the human a real fork the gate’s own buttons do not cover, such as doing the renames or leaving them. At most 2 replies, listed in one Replies menu beside the main button; choosing one sends its message to you as their feedback. Leave it out when approving, closing or typing a message is enough.',
  maxItems: L.actions,
  items: {
    type: 'object',
    properties: {
      label: limitedText('The button, a few words in sentence case: "Do the renames".', L.actionLabel),
      message: limitedText(
        'What the click sends you, written as the human would say it: "Do the renames you listed."',
        L.actionMessage
      ),
    },
    required: ['label', 'message'],
  },
};
