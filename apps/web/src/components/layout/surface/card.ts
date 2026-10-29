import { TONE_EDGE, TONE_WASH, type Tone } from '@/lib/format/tone.ts';

export const CARD = 'corner-superellipse/1.125 rounded-xl border border-border bg-card';

export const ATTACHMENT_CORNER = 'corner-superellipse/1.125 rounded-xl';

export const ATTACHMENT_TILE_CORNER = 'corner-superellipse/1.125 rounded-sm';

const INSET_SHAPE = 'corner-superellipse/1.125 rounded-lg border';

export const INSET = `${INSET_SHAPE} ${TONE_EDGE.neutral}`;

export const TONE_INSET = Object.fromEntries(
  Object.entries(TONE_EDGE).map(([tone, edge]) => [tone, `${INSET_SHAPE} ${edge} ${TONE_WASH[tone as Tone]}`])
) as Record<Tone, string>;

export const ICON_SLOT = 'grid size-5 shrink-0 place-items-center';

export const ICON_SLOT_GAP = 'gap-1.25';

export const CARD_INSET = 'px-3';

export const CARD_HEADER =
  'flex h-9 shrink-0 items-center gap-1.25 bg-bg-a1 ps-3 pe-3 font-medium text-fg-4 text-xs';

export const CHAT_COLUMN = '[--chat-inset:--spacing(3.25)]';

export const CHAT_NESTED = '[--chat-inset:--spacing(3)]';

export const CHAT_INSET = 'ps-(--chat-inset)';

export const CHAT_PROSE_INSET = 'px-(--chat-inset)';

export const CARD_FOOTER = 'border-border border-t bg-bg-a1 px-3 py-2.5';

export const COMPOSER_FIELD =
  'field-sizing-content w-full resize-none bg-transparent px-3 pt-2.5 pb-1 text-fg-4 text-xs outline-none placeholder:text-fg-2';

export const COMPOSER_FOOTER = 'flex items-center gap-2 p-1.5';

export const CHIP = 'corner-superellipse/1.125 w-fit rounded-control-sm bg-bg-a2 px-1 py-px text-fg-3';
