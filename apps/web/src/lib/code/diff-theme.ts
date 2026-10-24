import { DIFF_ROW_HEIGHT } from '@/lib/code/diff-view.ts';

export const DIFF_STYLE = {
  '--diffs-font-family': 'var(--font-mono)',
  '--diffs-header-font-family': 'var(--font-sans)',
  '--diffs-font-size': 'var(--text-2xs)',
  '--diffs-line-height': `${DIFF_ROW_HEIGHT}px`,
  '--diffs-tab-size': '2',
  '--diffs-addition-color-override': 'var(--green-4)',
  '--diffs-deletion-color-override': 'var(--red-4)',
  '--diffs-modified-color-override': 'var(--primary-4)',
  '--diffs-fg-number-override': 'var(--fg-2)',
  '--diffs-fg-number-addition-override': 'var(--green-text)',
  '--diffs-fg-number-deletion-override': 'var(--red-text)',
  '--diffs-bg-separator-override': 'var(--bg-a1)',
  '--diffs-bg-context-override': 'var(--bg-a1)',
  '--diffs-bg-buffer-override': 'transparent',
  '--diffs-bg-addition-emphasis-override': 'var(--code-added-strong)',
  '--diffs-bg-deletion-emphasis-override': 'var(--code-removed-strong)',
  '--diffs-bg-hover-override': 'var(--fg-4)',
  '--diffs-bg-selection-override': 'var(--primary-4)',
};

export const DIFF_CSS = `
[data-line-type='change-addition']:is([data-line], [data-no-newline], [data-column-number], [data-gutter-buffer]) {
  --diffs-computed-diff-line-bg: var(--code-added);
}
[data-line-type='change-deletion']:is([data-line], [data-no-newline], [data-column-number], [data-gutter-buffer]) {
  --diffs-computed-diff-line-bg: var(--code-removed);
}
[data-selected-line]:is([data-line], [data-no-newline]) {
  --mix-selection-light: 93%;
  --mix-selection-dark: 90%;
}
[data-selected-line]:is([data-column-number], [data-gutter-buffer]) {
  --mix-selection-light: 88%;
  --mix-selection-dark: 82%;
}
[data-separator] {
  font-size: var(--text-2xs);
  color: var(--fg-2);
}
`;
