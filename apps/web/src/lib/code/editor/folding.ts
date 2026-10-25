import { codeFolding, foldGutter, foldService } from '@codemirror/language';
import type { EditorState, Extension, Text } from '@codemirror/state';

export interface FoldMarkers {
  create: (open: boolean) => HTMLElement;
}

const SCAN_LIMIT = 5000;

const folds = new WeakMap<Text, Map<number, { from: number; to: number } | null>>();

export function measureIndent(text: string, tabSize: number) {
  let width = 0;
  for (const character of text) {
    if (character === ' ') width += 1;
    else if (character === '\t') width += tabSize - (width % tabSize);
    else return width;
  }
  return -1;
}

export function resolveIndentFold(state: EditorState, lineStart: number) {
  const doc = state.doc;
  const line = doc.lineAt(lineStart);
  const cached = folds.get(doc)?.get(line.number);
  if (cached !== undefined) return cached;
  const tabSize = state.tabSize;
  const indent = measureIndent(line.text, tabSize);
  let last = line.number;
  if (indent >= 0) {
    const limit = Math.min(doc.lines, line.number + SCAN_LIMIT);
    for (let number = line.number + 1; number <= limit; number += 1) {
      const next = measureIndent(doc.line(number).text, tabSize);
      if (next < 0) continue;
      if (next <= indent) break;
      last = number;
    }
  }
  const range = last > line.number ? { from: line.to, to: doc.line(last).to } : null;
  const known = folds.get(doc) ?? new Map<number, { from: number; to: number } | null>();
  known.set(line.number, range);
  folds.set(doc, known);
  return range;
}

export const indentFolding = foldService.of((state, lineStart) => resolveIndentFold(state, lineStart));

function createPlaceholder(_view: unknown, onclick: (event: Event) => void) {
  const dom = document.createElement('span');
  dom.className = 'cm-foldPlaceholder';
  dom.textContent = '⋯';
  dom.setAttribute('aria-label', 'Folded lines');
  dom.onclick = onclick;
  return dom;
}

export function createFolding(markers: FoldMarkers): Extension {
  return [
    codeFolding({ placeholderDOM: createPlaceholder }),
    foldGutter({ markerDOM: (open) => markers.create(open) }),
  ];
}

export function createChevronMarkers(markup: () => string): FoldMarkers {
  return {
    create: (open) => {
      const dom = document.createElement('span');
      dom.className = open ? 'cm-fold-open' : 'cm-fold-closed';
      dom.innerHTML = markup();
      return dom;
    },
  };
}
