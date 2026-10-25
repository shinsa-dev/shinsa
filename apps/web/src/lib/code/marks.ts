export const CODE_MARKS = {
  open: 'shinsa:code-open',
  shown: 'shinsa:code-shown',
  toggle: 'shinsa:tree-toggle',
  toggled: 'shinsa:tree-toggled',
} as const;

let pending: { name: string; detail: string } | null = null;

function isTimed() {
  return typeof performance !== 'undefined' && typeof performance.mark === 'function';
}

export function markCode(name: typeof CODE_MARKS.open | typeof CODE_MARKS.toggle, detail: string) {
  if (!isTimed()) return;
  performance.mark(name, { detail });
  pending = { name, detail };
}

export function measureCode(name: typeof CODE_MARKS.shown | typeof CODE_MARKS.toggled, detail: string) {
  const start = pending;
  if (!start || start.detail !== detail || !isTimed()) return null;
  pending = null;
  return performance.measure(name, { start: start.name, detail });
}
