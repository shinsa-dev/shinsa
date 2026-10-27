import { EditorView } from '@codemirror/view';
import { COMMENT_TAGS } from '@/lib/code/comment-tags.ts';
import { listThemeColors, resolveColorClass } from '@/lib/code/grammar.ts';

const TONES = ['neutral', 'blue', 'amber', 'orange', 'green', 'red', 'purple'] as const;

const TONE_COLOR: Record<(typeof TONES)[number], string> = {
  neutral: 'var(--fg-2)',
  blue: 'var(--primary-4)',
  amber: 'var(--amber-4)',
  orange: 'var(--orange-4)',
  green: 'var(--green-4)',
  red: 'var(--red-4)',
  purple: 'var(--purple-4)',
};

function listSpotTones() {
  return Object.fromEntries(
    TONES.map((tone) => [`.cm-spotMark.cm-spot-${tone}`, { backgroundColor: TONE_COLOR[tone] }])
  );
}

function listTokenStyles() {
  const styles: Record<string, Record<string, string>> = {};
  for (const color of listThemeColors()) {
    const className = resolveColorClass(color);
    if (className) styles[`.${className}`] = { color };
  }
  for (const tag of Object.values(COMMENT_TAGS)) styles[`.${tag.className}`] = { ...tag.style };
  return {
    ...styles,
    '.tm-italic': { fontStyle: 'italic' },
    '.tm-bold': { fontWeight: '600' },
    '.tm-underline': { textDecoration: 'underline' },
    '.tm-strike': { textDecoration: 'line-through' },
  };
}

const codeTheme = EditorView.theme({
  '&': {
    height: '100%',
    color: 'var(--fg-4)',
    backgroundColor: 'transparent',
    fontSize: 'var(--text-2xs)',
    containerType: 'inline-size',
  },
  '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '18px', overflow: 'auto' },
  '.cm-content': { padding: '4px 0', caretColor: 'var(--fg-4)' },
  '.cm-line': { padding: '0 24px 0 8px' },
  '&.cm-focused': { outline: 'none' },
  '.cm-cursor': { borderLeftColor: 'var(--fg-4)' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': {
    backgroundColor: 'var(--primary-a2) !important',
  },
  '.cm-gutters': {
    backgroundColor: 'var(--background)',
    color: 'var(--fg-2)',
    border: 'none',
    fontVariantNumeric: 'tabular-nums',
  },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 4px 0 16px', minWidth: '44px', cursor: 'pointer' },
  '.cm-foldGutter .cm-gutterElement': {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '16px',
    color: 'var(--fg-2)',
    cursor: 'pointer',
  },
  '.cm-foldGutter .cm-gutterElement:hover': { color: 'var(--fg-4)' },
  '.cm-fold-open, .cm-fold-closed': { display: 'flex' },
  '.cm-fold-open': { visibility: 'hidden', transform: 'rotate(90deg)' },
  '.cm-gutters:hover .cm-fold-open': { visibility: 'visible' },
  '.cm-foldPlaceholder': {
    display: 'inline-block',
    margin: '0 4px',
    padding: '0 4px',
    border: 'none',
    borderRadius: '3px',
    backgroundColor: 'var(--bg-a2)',
    color: 'var(--fg-2)',
    lineHeight: '16px',
    cursor: 'pointer',
  },
  '.cm-foldPlaceholder:hover': { backgroundColor: 'var(--bg-a3)', color: 'var(--fg-4)' },
  ...listTokenStyles(),
  '.cm-lineNumbers .cm-gutterElement:hover': { color: 'var(--primary-text)' },
  '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'transparent' },
  '.cm-insertedLine, &.cm-merge-b .cm-changedLine': { backgroundColor: 'var(--code-added)' },
  '.cm-insertedText, &.cm-merge-b .cm-changedText': {
    backgroundColor: 'var(--code-added-strong)',
    background: 'var(--code-added-strong)',
    textDecoration: 'none',
  },
  '.cm-deletedLine, &.cm-merge-a .cm-changedLine': { backgroundColor: 'var(--code-removed)' },
  '.cm-deletedText, &.cm-merge-a .cm-changedText': {
    backgroundColor: 'var(--code-removed-strong)',
    background: 'var(--code-removed-strong)',
    textDecoration: 'none',
  },
  '.cm-deletedChunk': { padding: '0', backgroundColor: 'transparent' },
  '.cm-deletedLine': { padding: '0 24px 0 8px', textDecoration: 'none' },
  '.cm-deletedLine del': { textDecoration: 'none' },
  '.cm-oldLines': { display: 'flex', flexDirection: 'column', color: 'var(--red-text)' },
  '.cm-oldLines > div': { height: '18px', cursor: 'pointer' },
  '.cm-oldLines > div:hover': { color: 'var(--primary-text)' },
  '.cm-collapsedLines': {
    backgroundColor: 'var(--bg-a1)',
    backgroundImage: 'none',
    color: 'var(--fg-2)',
    fontFamily: 'var(--font-sans)',
    fontSize: 'var(--text-2xs)',
    padding: '3px 8px 3px calc(8px + var(--scroll-left, 0px))',
    cursor: 'pointer',
  },
  '.cm-collapsedLines:before, .cm-collapsedLines:after': { content: 'none', display: 'none' },
  '.cm-collapsedLines:hover': { backgroundColor: 'var(--bg-a2)', color: 'var(--fg-4)' },
  '.cm-mergeSpacer': { backgroundColor: 'var(--bg-a1)' },
  '.cm-spotGutter': { width: '12px' },
  '.cm-spotGutter .cm-gutterElement': { display: 'flex', justifyContent: 'flex-end' },
  '.cm-spotMark': { width: '3px', height: '100%', marginLeft: 'auto', cursor: 'default' },
  ...listSpotTones(),
  '.cm-searchMatch': { backgroundColor: 'var(--amber-a2)', outline: 'none' },
  '.cm-searchMatch-selected': { backgroundColor: 'var(--amber-a4)' },
  '.cm-selectionMatch': { backgroundColor: 'var(--bg-a2)' },
  '.cm-panels': {
    backgroundColor: 'var(--background)',
    color: 'var(--fg-3)',
    fontFamily: 'var(--font-sans)',
  },
  '.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--border)' },
  '.cm-panels.cm-panels-bottom': { borderTop: '1px solid var(--border)' },
  '.cm-panel': { fontSize: 'var(--text-2xs)', padding: '6px 8px' },
  '.cm-panel.cm-find': { padding: '0' },
  '.cm-textfield': {
    backgroundColor: 'var(--bg-2)',
    border: 'none',
    borderRadius: 'var(--radius-control-sm)',
    color: 'var(--fg-4)',
    fontSize: 'var(--text-2xs)',
    padding: '3px 8px',
    outline: 'none',
  },
  '.cm-button': {
    backgroundColor: 'var(--bg-a2)',
    backgroundImage: 'none',
    border: 'none',
    borderRadius: 'var(--radius-control-sm)',
    color: 'var(--fg-3)',
    fontSize: 'var(--text-2xs)',
    padding: '3px 8px',
  },
  '.cm-button:hover, .cm-button:active': {
    backgroundColor: 'var(--bg-a3)',
    backgroundImage: 'none',
    color: 'var(--fg-4)',
  },
  '.cm-note-slot': {
    padding: '6px 8px',
    fontFamily: 'var(--font-sans)',
    whiteSpace: 'normal',
    transform: 'translateX(var(--scroll-left, 0px))',
  },
});

export const CODE_THEME = [codeTheme];
