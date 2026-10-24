import { describe, expect, it } from 'bun:test';
import { EditorState, Text } from '@codemirror/state';
import {
  annotationsField,
  buildAnnotations,
  createLineMouseDown,
  NO_ANNOTATIONS,
  resolveSelectedLines,
  SlotWidget,
  selectAnnotations,
  setAnnotations,
} from '@/lib/code/editor/annotations.ts';
import { SlotRegistry } from '@/lib/code/editor/slots.ts';
import { createView } from './support.ts';

const DOC = Text.of(['one', 'two', 'three', 'four']);

function listDecorations(set: ReturnType<typeof buildAnnotations>) {
  const found: { from: number; className: string | null; key: string | null }[] = [];
  set.between(0, DOC.length, (from, _to, value) => {
    const widget = value.spec.widget as SlotWidget | undefined;
    found.push({
      from,
      className: (value.spec.class as string | undefined) ?? null,
      key: widget?.key ?? null,
    });
  });
  return found;
}

describe('buildAnnotations', () => {
  it('washes a spot’s lines in its tone and puts each note under its line, clamped to the file', () => {
    const registry = new SlotRegistry();
    const set = buildAnnotations(
      DOC,
      {
        ...NO_ANNOTATIONS,
        notes: [
          { key: 'n1', line: 2 },
          { key: 'n2', line: 99 },
        ],
        spots: [{ key: 's', from: 0, to: 2, tone: 'red', selected: true }],
      },
      registry
    );
    expect(listDecorations(set)).toEqual([
      { from: 0, className: 'cm-spot cm-spot-red cm-spot-selected', key: null },
      { from: 4, className: 'cm-spot cm-spot-red cm-spot-selected', key: null },
      { from: 7, className: null, key: 'n1' },
      { from: 18, className: null, key: 'n2' },
    ]);
  });
});

describe('annotationsField', () => {
  it('takes the latest annotations and keeps them in place while the text changes', () => {
    const registry = new SlotRegistry();
    const field = annotationsField(registry, NO_ANNOTATIONS);
    let state = EditorState.create({ doc: DOC, extensions: field });
    expect(state.field(field).size).toBe(0);
    const value = { ...NO_ANNOTATIONS, notes: [{ key: 'n', line: 1 }] };
    const effects = [setAnnotations.of(NO_ANNOTATIONS), setAnnotations.of(value)];
    expect(selectAnnotations(effects)).toBe(value);
    expect(selectAnnotations([])).toBeNull();
    state = state.update({ effects }).state;
    expect(state.field(field).size).toBe(1);
    state = state.update({ changes: { from: 0, insert: 'zero\n' } }).state;
    const positions: number[] = [];
    state.field(field).between(0, state.doc.length, (from) => {
      positions.push(from);
    });
    expect(positions).toEqual([8]);
  });
});

describe('SlotWidget', () => {
  it('draws a slot React fills, ignores the editor’s events and releases the slot when removed', () => {
    const registry = new SlotRegistry();
    const widget = new SlotWidget('n', registry);
    expect(widget.eq(new SlotWidget('n', registry))).toBe(true);
    expect(widget.eq(new SlotWidget('m', registry))).toBe(false);
    const dom = widget.toDOM();
    expect(registry.read().get('n')).toBe(dom);
    expect(widget.ignoreEvent()).toBe(true);
    widget.destroy(dom);
    expect(registry.read().size).toBe(0);
  });
});

describe('the comment gutter', () => {
  it('reports a click on a line number with the selected lines', () => {
    const clicks: number[] = [];
    const view = createView('a\nb\nc', []);
    const press = createLineMouseDown((line) => {
      clicks.push(line);
      return line !== 3;
    });
    expect(press(view, { from: 2 }, new MouseEvent('mousedown', { button: 0 }))).toBe(true);
    expect(press(view, { from: 4 }, new MouseEvent('mousedown', { button: 0 }))).toBe(false);
    expect(press(view, { from: 2 }, new MouseEvent('mousedown', { button: 2 }))).toBe(false);
    expect(clicks).toEqual([2, 3]);
    expect(resolveSelectedLines(view)).toBeNull();
    view.dispatch({ selection: { anchor: 0, head: 3 } });
    expect(resolveSelectedLines(view)).toEqual({ from: 1, to: 2 });
  });
});
