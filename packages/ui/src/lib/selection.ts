/**
 * The selection policy's one class: real content a person may want to copy
 * opts back into selection with it (globals.css → `@utility selectable`).
 * Everything else in the app is chrome and never selected.
 */
export const SELECTABLE = 'selectable';

const REGION = `.${SELECTABLE}`;

/** Places that select their own text: fields, editors and terminals. */
const OWN_SELECTION =
  'input, textarea, select, [contenteditable]:not([contenteditable="false"]), .xterm, .cm-editor';

function isSelectAllKey(event: KeyboardEvent) {
  if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return false;
  return event.key.toLowerCase() === 'a';
}

function readElement(node: Node | null | undefined): Element | null {
  if (!node) return null;
  return node instanceof Element ? node : (node.parentElement ?? null);
}

/** The outermost content region around `node`, or null when it sits in chrome. */
export function resolveSelectionRegion(node: Node | null | undefined): Element | null {
  let region: Element | null = null;
  let next = readElement(node)?.closest(REGION) ?? null;
  while (next) {
    region = next;
    next = next.parentElement?.closest(REGION) ?? null;
  }
  return region;
}

/**
 * ⌘A (Ctrl A) scoped like a native app: in a field, an editor or a terminal it
 * keeps its own meaning; inside a content region (where the selection or the
 * focus is) it selects that region alone; anywhere else it selects nothing,
 * never the whole page.
 */
export function scopeSelectAll(event: KeyboardEvent) {
  if (event.defaultPrevented || !isSelectAllKey(event)) return;
  const target = readElement(event.target as Node | null);
  if (target?.closest(OWN_SELECTION)) return;
  event.preventDefault();
  const selection = document.getSelection();
  const region = resolveSelectionRegion(selection?.anchorNode) ?? resolveSelectionRegion(target);
  if (region) selection?.selectAllChildren(region);
}
