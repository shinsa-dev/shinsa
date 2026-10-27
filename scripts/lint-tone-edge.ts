const HUE = '(?:red|orange|amber|green|blue|primary|purple|sky|yellow|pink)';

const EDGE = String.raw`[\s'"\x60]`;

const TONE_FILL = String.raw`(?:(?:^|[\s'"\x60:])bg-${HUE}-(?:a[1-3]|[1-3])(?:/\d+)?(?=${EDGE}|$)|\bTONE_(?:WASH|SURFACE)\[)`;

const NEUTRAL_EDGE = String.raw`(?:(?:^|[\s'"\x60(,:{$])INSET\b(?!_)|(?:^|[\s'"\x60:])border(?:-[trblxyse])?(?=${EDGE}|$)|(?:^|[\s'"\x60:])border-(?:border|bg-[1-4])(?=${EDGE}|$))`;

export const TONE_EDGE_RULE = {
  pattern: new RegExp(`^(?=.*${TONE_FILL})(?=.*${NEUTRAL_EDGE})`),
  unless: new RegExp(String.raw`(?:^|[\s'"\x60:])border-${HUE}-|\bTONE_(?:EDGE|INSET)\b`),
  message:
    'A tone fill on the grey hairline. A box filled in a tone takes that tone’s edge: TONE_INSET or TONE_EDGE from lib/format/tone.ts (border-‹tone›-a3), never border-border or INSET under a tinted fill (docs/design.md → Where Shinsa differs, 15)',
};
