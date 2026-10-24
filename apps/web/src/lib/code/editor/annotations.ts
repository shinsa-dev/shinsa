import { type Extension, type Range, StateEffect, StateField, type Text } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, lineNumbers, WidgetType } from '@codemirror/view';
import type { CodeSpotMark } from '@/lib/code/notes.ts';
import { createSlotElement, type SlotRegistry } from './slots.ts';

interface NoteAnchor {
  key: string;
  line: number;
}

export interface EditorAnnotations {
  notes: readonly NoteAnchor[];
  oldNotes: readonly NoteAnchor[];
  spots: readonly CodeSpotMark[];
  keep: readonly number[];
}

export const NO_ANNOTATIONS: EditorAnnotations = { notes: [], oldNotes: [], spots: [], keep: [] };

export const setAnnotations = StateEffect.define<EditorAnnotations>();

export function selectAnnotations(effects: readonly StateEffect<unknown>[]) {
  let found: EditorAnnotations | null = null;
  for (const effect of effects) if (effect.is(setAnnotations)) found = effect.value;
  return found;
}

export class SlotWidget extends WidgetType {
  constructor(
    readonly key: string,
    readonly registry: SlotRegistry
  ) {
    super();
  }

  override eq(other: SlotWidget) {
    return other.key === this.key && other.registry === this.registry;
  }

  toDOM() {
    return createSlotElement(this.key, this.registry);
  }

  override destroy(dom: HTMLElement) {
    this.registry.release(this.key, dom);
  }

  override ignoreEvent() {
    return true;
  }
}

function clampLine(doc: Text, line: number) {
  return doc.line(Math.min(Math.max(line, 1), doc.lines));
}

export function buildAnnotations(doc: Text, value: EditorAnnotations, registry: SlotRegistry): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  for (const spot of value.spots) {
    const className = `cm-spot cm-spot-${spot.tone}${spot.selected ? ' cm-spot-selected' : ''}`;
    for (let line = Math.max(spot.from, 1); line <= Math.min(spot.to, doc.lines); line += 1) {
      ranges.push(Decoration.line({ class: className }).range(doc.line(line).from));
    }
  }
  for (const note of value.notes) {
    const line = clampLine(doc, note.line);
    ranges.push(
      Decoration.widget({ block: true, side: 1, widget: new SlotWidget(note.key, registry) }).range(line.to)
    );
  }
  return Decoration.set(ranges, true);
}

export function annotationsField(registry: SlotRegistry, initial: EditorAnnotations) {
  return StateField.define<DecorationSet>({
    create: (state) => buildAnnotations(state.doc, initial, registry),
    update(decorations, transaction) {
      const next = selectAnnotations(transaction.effects);
      if (next) return buildAnnotations(transaction.state.doc, next, registry);
      return decorations.map(transaction.changes);
    },
    provide: (field) => EditorView.decorations.from(field),
  });
}

export function resolveSelectedLines(view: EditorView) {
  const { from, to } = view.state.selection.main;
  if (from === to) return null;
  return { from: view.state.doc.lineAt(from).number, to: view.state.doc.lineAt(to).number };
}

type LineHandler = (line: number, view: EditorView) => boolean;

export function createLineMouseDown(onLine: LineHandler) {
  return (view: EditorView, block: { from: number }, event: Event) => {
    if ((event as MouseEvent).button !== 0) return false;
    return onLine(view.state.doc.lineAt(block.from).number, view);
  };
}

export function commentGutter(onLine: LineHandler): Extension {
  return lineNumbers({ domEventHandlers: { mousedown: createLineMouseDown(onLine) } });
}
