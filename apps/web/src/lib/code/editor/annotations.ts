import {
  type Extension,
  Prec,
  type Range,
  RangeSet,
  StateEffect,
  StateField,
  type Text,
} from '@codemirror/state';
import {
  Decoration,
  type DecorationSet,
  EditorView,
  GutterMarker,
  gutter,
  lineNumbers,
  WidgetType,
} from '@codemirror/view';
import type { CodeSpotMark } from '@/lib/code/notes.ts';
import { attachSlot, detachSlot, type SlotRegistry } from './slots.ts';
import type { SpotHintRegistry } from './spot-hints.ts';

interface NoteAnchor {
  key: string;
  line: number;
}

export interface FocusLines {
  from: number;
  to: number;
  flash: boolean;
}

export interface EditorAnnotations {
  notes: readonly NoteAnchor[];
  oldNotes: readonly NoteAnchor[];
  spots: readonly CodeSpotMark[];
  keep: readonly number[];
  focus: FocusLines | null;
}

export const NO_ANNOTATIONS: EditorAnnotations = {
  notes: [],
  oldNotes: [],
  spots: [],
  keep: [],
  focus: null,
};

interface AnnotationSets {
  decorations: DecorationSet;
  markers: RangeSet<GutterMarker>;
}

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

  override get estimatedHeight() {
    return this.registry.readHeight(this.key);
  }

  toDOM() {
    return attachSlot(this.key, this.registry);
  }

  override destroy(dom: HTMLElement) {
    detachSlot(this.key, this.registry, dom);
  }

  override ignoreEvent() {
    return true;
  }
}

export class SpotMarker extends GutterMarker {
  constructor(
    readonly tone: string,
    readonly label: string,
    readonly hints: SpotHintRegistry | null = null
  ) {
    super();
  }

  override eq(other: SpotMarker) {
    return other.tone === this.tone && other.label === this.label;
  }

  override toDOM() {
    const dom = document.createElement('div');
    dom.className = `cm-spotMark cm-spot-${this.tone}`;
    dom.setAttribute('aria-label', this.label);
    this.hints?.add(dom, this.label);
    return dom;
  }

  override destroy(dom: Node) {
    this.hints?.remove(dom as HTMLElement);
  }
}

function clampLine(doc: Text, line: number) {
  return doc.line(Math.min(Math.max(line, 1), doc.lines));
}

function listLines(doc: Text, from: number, to: number) {
  const lines: number[] = [];
  for (let line = Math.max(from, 1); line <= Math.min(to, doc.lines); line += 1) lines.push(line);
  return lines;
}

const TONE_ORDER = ['red', 'amber', 'orange', 'purple', 'blue', 'green', 'neutral'];

function rankTone(tone: string) {
  const rank = TONE_ORDER.indexOf(tone);
  return rank < 0 ? TONE_ORDER.length : rank;
}

export function buildSpotMarkers(
  doc: Text,
  spots: readonly CodeSpotMark[],
  hints: SpotHintRegistry | null = null
): RangeSet<GutterMarker> {
  const byLine = new Map<number, { tone: string; labels: string[] }>();
  for (const spot of spots) {
    for (const line of listLines(doc, spot.from, spot.to)) {
      const known = byLine.get(line);
      if (!known) {
        byLine.set(line, { tone: spot.tone, labels: [spot.label] });
        continue;
      }
      if (rankTone(spot.tone) < rankTone(known.tone)) known.tone = spot.tone;
      if (!known.labels.includes(spot.label)) known.labels.push(spot.label);
    }
  }
  const ranges = [...byLine].map(([line, mark]) =>
    new SpotMarker(mark.tone, mark.labels.join('\n'), hints).range(doc.line(line).from)
  );
  return RangeSet.of(ranges, true);
}

export function buildAnnotations(doc: Text, value: EditorAnnotations, registry: SlotRegistry): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  for (const spot of value.spots) {
    if (!spot.selected) continue;
    for (const line of listLines(doc, spot.from, spot.to)) {
      ranges.push(Decoration.line({ class: 'cm-spot-selected' }).range(doc.line(line).from));
    }
  }
  const focus = value.focus;
  if (focus) {
    const className = focus.flash ? 'cm-focus-line cm-focus-flash' : 'cm-focus-line';
    for (const line of listLines(doc, focus.from, focus.to)) {
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

function buildSets(
  doc: Text,
  value: EditorAnnotations,
  registry: SlotRegistry,
  hints: SpotHintRegistry | null
): AnnotationSets {
  return {
    decorations: buildAnnotations(doc, value, registry),
    markers: buildSpotMarkers(doc, value.spots, hints),
  };
}

export function annotationsField(
  registry: SlotRegistry,
  initial: EditorAnnotations,
  hints: SpotHintRegistry | null = null
): Extension {
  const field = StateField.define<AnnotationSets>({
    create: (state) => buildSets(state.doc, initial, registry, hints),
    update(sets, transaction) {
      const next = selectAnnotations(transaction.effects);
      if (next) return buildSets(transaction.state.doc, next, registry, hints);
      if (!transaction.docChanged) return sets;
      return {
        decorations: sets.decorations.map(transaction.changes),
        markers: sets.markers.map(transaction.changes),
      };
    },
    provide: (value) => EditorView.decorations.from(value, (sets) => sets.decorations),
  });
  return [
    field,
    Prec.highest(gutter({ class: 'cm-spotGutter', markers: (view) => view.state.field(field).markers })),
  ];
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
