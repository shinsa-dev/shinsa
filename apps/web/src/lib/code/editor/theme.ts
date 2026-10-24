import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import { tags } from '@lezer/highlight';

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
    TONES.map((tone) => [`.cm-spot-${tone}`, { boxShadow: `inset 2px 0 0 ${TONE_COLOR[tone]}` }])
  );
}

export const codeHighlight = HighlightStyle.define([
  {
    tag: [tags.keyword, tags.controlKeyword, tags.moduleKeyword, tags.operatorKeyword],
    color: 'var(--code-keyword)',
  },
  { tag: [tags.string, tags.special(tags.string), tags.character, tags.regexp], color: 'var(--code-string)' },
  { tag: [tags.number, tags.bool, tags.null, tags.atom], color: 'var(--code-number)' },
  { tag: [tags.comment, tags.lineComment, tags.blockComment, tags.docComment], color: 'var(--code-comment)' },
  {
    tag: [tags.function(tags.variableName), tags.function(tags.propertyName)],
    color: 'var(--code-function)',
  },
  {
    tag: [tags.typeName, tags.className, tags.namespace, tags.definition(tags.typeName)],
    color: 'var(--code-type)',
  },
  { tag: [tags.propertyName, tags.attributeName], color: 'var(--code-property)' },
  { tag: [tags.tagName, tags.heading], color: 'var(--code-tag)' },
  { tag: [tags.punctuation, tags.bracket, tags.operator, tags.separator], color: 'var(--code-punctuation)' },
  { tag: [tags.meta, tags.processingInstruction, tags.annotation], color: 'var(--code-meta)' },
  { tag: tags.link, color: 'var(--code-function)', textDecoration: 'underline' },
  { tag: tags.strong, fontWeight: '600' },
  { tag: tags.invalid, color: 'var(--red-text)' },
]);

const codeTheme = EditorView.theme({
  '&': {
    height: '100%',
    color: 'var(--fg-4)',
    backgroundColor: 'transparent',
    fontSize: 'var(--text-2xs)',
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
    backgroundColor: 'transparent',
    color: 'var(--fg-2)',
    border: 'none',
    fontVariantNumeric: 'tabular-nums',
  },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 8px 0 16px', minWidth: '48px', cursor: 'pointer' },
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
    padding: '3px 8px',
    cursor: 'pointer',
  },
  '.cm-collapsedLines:before, .cm-collapsedLines:after': { content: 'none', display: 'none' },
  '.cm-collapsedLines:hover': { backgroundColor: 'var(--bg-a2)', color: 'var(--fg-4)' },
  '.cm-mergeSpacer': { backgroundColor: 'var(--bg-a1)' },
  '.cm-changeGutter': { width: '2px', paddingLeft: '0' },
  '&.cm-merge-a .cm-changedLineGutter, .cm-deletedLineGutter': { backgroundColor: 'var(--red-4)' },
  '&.cm-merge-b .cm-changedLineGutter': { backgroundColor: 'var(--green-4)' },
  '.cm-spot-selected': { backgroundColor: 'var(--primary-a1)' },
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
  '.cm-panel input[type=checkbox]': { accentColor: 'var(--primary-4)' },
  '.cm-panel label': { fontSize: 'var(--text-2xs)', color: 'var(--fg-3)' },
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
  '.cm-panel button[name=close]': { color: 'var(--fg-2)', fontSize: '16px', cursor: 'pointer' },
  '.cm-note-slot': { padding: '6px 8px', fontFamily: 'var(--font-sans)', whiteSpace: 'normal' },
});

export const CODE_THEME = [codeTheme, syntaxHighlighting(codeHighlight)];
