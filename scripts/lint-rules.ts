import { SELECTION_CLASS_RULE } from './lint-selection.ts';
import { TONE_EDGE_RULE } from './lint-tone-edge.ts';

export interface ClassRule {
  pattern: RegExp;
  message: string;
  roots: readonly string[];
  unless?: RegExp;
  allowedIn?: string;
  inCatalog?: boolean;
}

export const BANNED_VERB_PATTERN = /^(get|fetch|load|set|delete|destroy)[A-Z]/;

export const VERB_CATALOG =
  'find*, select*, list*, count*, resolve*, create*, update*, upsert*, write*, replace*, remove*, assert*, serialize*, parse*, validate*, describe*, request*, sync*, apply*, record*, is*, has*, needs*';

export const APP = ['apps/web/src'];

export const APP_AND_KIT = ['apps/web/src', 'packages/ui/src'];

export const CATALOG = ['index', 'tokens', 'inputs', 'overlays', 'surfaces'].map(
  (name) => `apps/web/src/routes/ui/${name}.tsx`
);

export const ICON_FADE_MESSAGE =
  'An icon faded with opacity. Icons draw in a solid icon ink (icon-1…4) that their text colour sets; the only opacity on an icon is a reveal, opacity-0 → opacity-100 (docs/design.md → Where Shinsa differs, 19)';

export const ICON_SIZE_MESSAGE =
  'An icon sized with a class. Pass size: sm (14), md (16) or lg (20), or leave it to the primitive it sits in (docs/design.md → Iconography → Sizes)';

export const ICON_BRIGHTER_MESSAGE =
  'An icon brighter than its text. An icon takes its text’s ink (icon-N beside fg-N) or a quieter one, never a higher step (docs/design.md → Where Shinsa differs, 19)';

export const RAW_SVG_MESSAGE =
  'A hand-drawn svg. Draw glyphs with Icon (add a mark Central lacks to components/icon/custom.ts), so they take the icon size and ink (docs/design.md → Where Shinsa differs, 19)';

export const HOVER_TRANSITION_MESSAGE =
  'A transition on a hover, press or highlight colour. Washes, text and border colours on hover, press and selection appear at once; only motion (a sheet, a popup, a turning chevron, a sliding indicator) eases (docs/design.md → Motion)';

export const TAB_BAR_MESSAGE =
  'A hand-rolled tab bar. Every row of tabs is the kit’s Tabs (Choice for a labelled switch), whose selected pill or line slides on the movement clock (docs/design.md → Components → Every tab bar is the kit’s)';

export const STILL_INDICATOR_MESSAGE =
  'Transitions turned off for a whole subtree without sparing the tab indicators. Skip [data-motion=move] in the selector, so a selected pill still slides (docs/design.md → Components → Every tab bar is the kit’s)';

export const OWN_HIGHLIGHT_MESSAGE =
  'A row that draws its own hover or highlight background. A list of rows you pick from (a menu, a select, ⌘K, the rail, a queue, an option list) shares one highlight that slides to the row: put the rows in HighlightList or HoverHighlight and mark them data-highlight-item; the row only changes its text colour (docs/design.md → Motion → Highlights slide)';

export const LONE_OPTION_MESSAGE =
  'An option or menu item outside the shared highlight. Render it inside HighlightList or HoverHighlight (or use the kit’s menu, select and command items), so one highlight slides between the rows (docs/design.md → Motion → Highlights slide)';

const INSET_FILL =
  /(?:^|[\s'"`])(?:rounded-lg\b.*[\s'"`]bg-(?:bg-a?[1-3]|muted|card|background|[a-z]+-a[12])(?=[\s'"`]|$)|bg-(?:bg-a?[1-3]|muted|card|background|[a-z]+-a[12])(?=[\s'"`]|$).*[\s'"`]rounded-lg\b)/;

export const CLASS_RULES: ClassRule[] = [
  {
    pattern:
      /(?:^|[\s'"`:])(?:data-indicator-here|data-hovered|data-highlighted|data-\[highlighted\]|data-\[hovered\]):(?:[\w-]+:)*bg-/,
    message: OWN_HIGHLIGHT_MESSAGE,
    roots: APP_AND_KIT,
    inCatalog: true,
  },
  {
    pattern: /\]:(?:[\w-]+:)*(?:before|after):transition-none/,
    message:
      'The before: or after: variant on a subtree. It also sets content, so every element gains an empty box that a flex row lays out as an item; name the pseudo-element in the selector instead, [&_*::before]:… (docs/design.md → Components → Every tab bar is the kit’s)',
    roots: APP,
  },
  {
    pattern: /\[&_\*(?!::)[^\]\s'"`]*\]:(?:[\w-]+:)*transition-none/,
    unless: /data-motion=move/,
    message: STILL_INDICATOR_MESSAGE,
    roots: APP,
  },
  {
    pattern: /(?:^|[\s'"`:])transition-(?:colors|shadow)(?=[\s'"`]|$)/,
    message: HOVER_TRANSITION_MESSAGE,
    roots: APP_AND_KIT,
    inCatalog: true,
  },
  {
    pattern:
      /^(?=.*(?:^|[\s'"`:])(?:group-|peer-)?(?:hover|active)(?:\/[\w-]+)?:)(?=.*(?:^|[\s'"`:])transition(?:-\[[^\]]*\b(?:color|background-color|border-color|outline-color|box-shadow|fill|stroke)\b[^\]]*\])?(?=[\s'"`]|$))/,
    message: HOVER_TRANSITION_MESSAGE,
    roots: APP_AND_KIT,
    inCatalog: true,
  },
  {
    pattern: /(?:^|[\s:'"`])text-\[\d/,
    message: 'Raw font size. Use a type role (docs/design.md → Sizing → Type roles)',
    roots: APP,
  },
  {
    pattern: /(?:^|[\s:'"`])font-(?:thin|extralight|light|bold|extrabold|black|\[)/,
    message:
      'A weight other than normal, font-medium or font-semibold. Those three are the only weights (docs/design.md → Weight)',
    roots: APP,
  },
  {
    pattern: /(?:^|[\s:'"`])gap(?:-[xy])?-0\.5\b/,
    message:
      'A 2px gap. A title over its description is gap-px, anything wider is gap-1 or more. The one 2px gap is between the buttons of a section header, and SectionLabel owns it',
    roots: APP,
    allowedIn: 'apps/web/src/components/layout/page/section-label.tsx',
  },
  {
    pattern: /(?:^|[\s:'"`])shadow-(?:2xs|xs|sm|md|lg|xl|2xl|inner)\b/,
    message:
      'A Tailwind shadow. Depth comes from the shadow tokens: shadow-1…4 and shadow-control* (docs/design.md → No shadows)',
    roots: APP,
  },
  {
    pattern: /(?:^|[\s:'"`])(?:shadow|ring)-\[/,
    message:
      'A raw shadow or ring. Use the shadow tokens: shadow-1…4 and shadow-control* (docs/design.md → No shadows)',
    roots: APP,
  },
  {
    pattern: /svg[^\s'"`]*\]:(?:[\w-]+:)*(?:opacity|text|fill|stroke)-/,
    message: ICON_FADE_MESSAGE,
    roots: APP_AND_KIT,
  },
  {
    pattern: /svg[^\s'"`]*\]:(?:[\w-]+:)*(?:size|w|h)-/,
    message: ICON_SIZE_MESSAGE,
    roots: APP_AND_KIT,
  },
  {
    pattern: /\[--icon-(?:color|size)[\w-]*:/,
    message:
      'An icon ink or size set by hand. The text colour sets the ink and the Icon size prop (or the primitive) the size (docs/design.md → Where Shinsa differs, 19)',
    roots: APP,
  },
  {
    pattern: /(?:^|[\s'"`])hover:/,
    unless: /(?:^|[\s'"`])active:/,
    message:
      'Hover is the only feedback. Pair every hover: class with the same active: value on the same line (docs/design.md → Where Shinsa differs, 15)',
    roots: APP,
  },
  {
    pattern: /(?:^|[\s'"`])group-hover(?:\/[\w-]+)?:/,
    unless: /(?:^|[\s'"`])group-active(?:\/[\w-]+)?:|(?:^|[\s'"`])opacity-0\b/,
    message:
      'Hover is the only feedback. Pair group-hover: with group-active: (docs/design.md → Where Shinsa differs, 15)',
    roots: APP,
  },
  {
    pattern: /(?:^|[\s'"`])rounded-xl border border-border bg-card\b/,
    message:
      'A hand-built card. Use CARD from components/layout/surface/card.ts (docs/design.md → Where Shinsa differs, 15)',
    roots: APP,
  },
  {
    pattern: /(?:^|[\s'"`])rounded-lg border border-border\b/,
    message:
      'A hand-built inset box. Use INSET from components/layout/surface/card.ts, the one edge of everything nested in a card or the chat column (docs/design.md → Where Shinsa differs, 15)',
    roots: APP,
  },
  {
    pattern: INSET_FILL,
    unless: /(?:^|[\s'"`])(?:border|size-[\w.]+|opacity-0)(?=[\s'"`]|$)/,
    message:
      "A nested box with a fill and no edge. Everything nested in a card or the chat column has the card's hairline: put INSET from components/layout/surface/card.ts under the fill (docs/design.md → Where Shinsa differs, 15)",
    roots: APP,
  },
  { ...TONE_EDGE_RULE, roots: APP_AND_KIT, inCatalog: true },
  { ...SELECTION_CLASS_RULE, roots: APP_AND_KIT, inCatalog: true },
  {
    pattern: /(?:^|[\s:'"`])(?:[a-z]+:)*rounded(?:-[trblse]{1,2})?-\[(?!inherit\])/,
    message:
      'Raw corner. Corners come from the radius tokens, and a nested corner is concentric: inner = outer − padding. Use rounded-control / -control-sm / -popup / -item / -segment (globals.css → Corners), or add a derived token there',
    roots: APP_AND_KIT,
    inCatalog: true,
  },
  {
    pattern:
      /(?:^|[\s'"`])[^\s'"`]*\b(?:focus|focus-visible|focus-within)(?:\/[\w-]+)?:(?=[^\s'"`])|(?:^|[\s'"`:])ring-offset-/,
    message:
      'A focus state. Shinsa draws no focus rings, outlines or focus washes; keep outline-none (docs/design.md → No focus states)',
    roots: APP_AND_KIT,
  },
];

export const BANNED_ICON_PATTERN = /['"`]IconSparkle['"`]/;

export const BANNED_ICON_MESSAGE =
  'The sparkle icon. Shinsa never draws IconSparkle; pick an icon that names what the thing is (docs/design.md → Iconography)';

export const GREEN_MESSAGE =
  "A green checkmark. Checkmarks are the accent (only the progress track's done steps are green): CheckMark / CHECK_TEXT from components/status/check-mark.tsx";

export const STRETCHED_TRIGGER_MESSAGE =
  'A tooltip trigger that can stretch past its text. The element a Hint or TooltipTrigger wraps is inline or w-fit, so the empty rest of a row never opens the tooltip (docs/design.md → Where Shinsa differs, 13)';

export const TOOLTIP_DELAY_MESSAGE =
  'A tooltip with a delay of its own. Every tooltip waits TOOLTIP_DELAY and moves on within TOOLTIP_SKIP_DELAY (@shinsa/ui/components/tooltip); drop the delay (docs/design.md → Where Shinsa differs, 13)';

export const ECHO_TOOLTIP_MESSAGE =
  'A tooltip that repeats the text it sits on adds nothing. Make it say what the screen does not (where the control leads, what it covers) or drop it, keeping an aria-label only on an icon-only button (docs/design.md → Where Shinsa differs, 13)';

export const SHORTCUT_MESSAGE =
  'A global keyboard shortcut. ⌘K is the only shortcut, the Code tab adds ⌘P, ⇧⌘F, ⌘F and ⌘G, the Review tab J and K and the Terminal page ⌘T and ⌘W while they are open; they live in hooks/use-command-key.ts, hooks/use-code-keys.ts, hooks/use-review-keys.ts and hooks/use-terminal-keys.ts, and a terminal keeps its own keys through xterm.js (lib/terminal/keys.ts) (docs/design.md → Where Shinsa differs, 14, 32, 34 and 37)';

export const TIME_MESSAGE =
  'A time rendered without its tooltip. Render it through TimeAgo or Duration (components/text/time-ago.tsx), so hovering shows the exact time (docs/design.md → Where Shinsa differs, 13)';

export const TOAST_LIMIT = 40;

export const TOAST_PLACEHOLDER_LENGTH = 12;

export const TOAST_MESSAGE = `A toast longer than ${TOAST_LIMIT} characters wraps at the toaster's width. A toast is one short line: the outcome in a few words ("Request declined.", "Kai Lane joined."), no description; an inserted value counts as ${TOAST_PLACEHOLDER_LENGTH} (docs/design.md → Where Shinsa differs, 42)`;
