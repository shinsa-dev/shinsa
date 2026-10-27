import { describe, expect, it } from 'bun:test';
import { Text } from '@codemirror/state';
import {
  annotationsField,
  buildAnnotations,
  buildSpotMarkers,
  createLineMouseDown,
  NO_ANNOTATIONS,
  resolveSelectedLines,
  SlotWidget,
  SpotMarker,
  selectAnnotations,
  setAnnotations,
} from '@/lib/code/editor/annotations.ts';
import { SlotRegistry } from '@/lib/code/editor/slots.ts';
import { SpotHintRegistry } from '@/lib/code/editor/spot-hints.ts';
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
  it('washes the selected spot and the lines a link points at, and puts each note under its line', () => {
    const registry = new SlotRegistry();
    const set = buildAnnotations(
      DOC,
      {
        ...NO_ANNOTATIONS,
        notes: [
          { key: 'n1', line: 2 },
          { key: 'n2', line: 99 },
        ],
        spots: [
          { key: 's', from: 0, to: 2, tone: 'red', label: 'Critical', selected: true },
          { key: 't', from: 3, to: 3, tone: 'amber', label: 'Read carefully', selected: false },
        ],
        focus: { from: 3, to: 4, flash: true },
      },
      registry
    );
    expect(listDecorations(set)).toEqual([
      { from: 0, className: 'cm-spot-selected', key: null },
      { from: 4, className: 'cm-spot-selected', key: null },
      { from: 7, className: null, key: 'n1' },
      { from: 8, className: 'cm-focus-line cm-focus-flash', key: null },
      { from: 14, className: 'cm-focus-line cm-focus-flash', key: null },
      { from: 18, className: null, key: 'n2' },
    ]);
    const settled = buildAnnotations(
      DOC,
      { ...NO_ANNOTATIONS, focus: { from: 4, to: 4, flash: false } },
      registry
    );
    expect(listDecorations(settled)).toEqual([{ from: 14, className: 'cm-focus-line', key: null }]);
  });
});

describe('the spot gutter', () => {
  it('marks every line of a spot in its tone with what the spot is', () => {
    const markers = buildSpotMarkers(DOC, [
      { key: 's', from: 2, to: 9, tone: 'amber', label: 'Read carefully: the order', selected: false },
      { key: 't', from: 3, to: 3, tone: 'red', label: 'Critical: a finding', selected: false },
      { key: 'u', from: 4, to: 4, tone: 'neutral', label: 'Context', selected: false },
      { key: 'v', from: 4, to: 4, tone: 'pink' as 'red', label: 'Context', selected: false },
      { key: 'w', from: 2, to: 2, tone: 'amber', label: 'Read carefully: the order', selected: false },
    ]);
    const found: { from: number; tone: string; label: string }[] = [];
    markers.between(0, DOC.length, (from, _to, value) => {
      found.push({ from, tone: (value as SpotMarker).tone, label: (value as SpotMarker).label });
    });
    expect(found).toEqual([
      { from: 4, tone: 'amber', label: 'Read carefully: the order' },
      { from: 8, tone: 'red', label: 'Read carefully: the order\nCritical: a finding' },
      { from: 14, tone: 'amber', label: 'Read carefully: the order\nContext' },
    ]);
    const marker = new SpotMarker('amber', 'Read carefully: the order');
    expect(marker.eq(new SpotMarker('amber', 'Read carefully: the order'))).toBe(true);
    expect(marker.eq(new SpotMarker('red', 'Read carefully: the order'))).toBe(false);
    const dom = marker.toDOM();
    expect(dom.className).toBe('cm-spotMark cm-spot-amber');
    expect(dom.hasAttribute('title')).toBe(false);
    expect(dom.getAttribute('aria-label')).toBe('Read carefully: the order');
    marker.destroy(dom);
  });

  it('hands each drawn mark to the hint registry until it goes', async () => {
    const hints = new SpotHintRegistry();
    const marker = new SpotMarker('red', 'Critical', hints);
    const dom = marker.toDOM();
    await Promise.resolve();
    expect(hints.read().map((hint) => [hint.element, hint.label])).toEqual([[dom, 'Critical']]);
    marker.destroy(dom);
    await Promise.resolve();
    expect(hints.read()).toEqual([]);
  });

  it('draws the marks in the editor, before the line numbers', async () => {
    const registry = new SlotRegistry();
    const spots = [{ key: 's', from: 1, to: 1, tone: 'red' as const, label: 'Critical', selected: false }];
    const hints = new SpotHintRegistry();
    const view = createView('a\nb', [annotationsField(registry, { ...NO_ANNOTATIONS, spots }, hints)]);
    const gutters = [...view.dom.querySelectorAll('.cm-gutter')].map((gutter) => gutter.className);
    expect(gutters[0]).toContain('cm-spotGutter');
    expect(view.dom.querySelector('.cm-spotMark')?.getAttribute('aria-label')).toBe('Critical');
    view.dispatch({ effects: setAnnotations.of(NO_ANNOTATIONS) });
    await Promise.resolve();
    expect(hints.read()).toEqual([]);
  });
});

describe('annotationsField', () => {
  it('takes the latest annotations and keeps them in place while the text changes', () => {
    const registry = new SlotRegistry();
    const view = createView(DOC.toString(), [annotationsField(registry, NO_ANNOTATIONS)]);
    const value = { ...NO_ANNOTATIONS, notes: [{ key: 'n', line: 1 }] };
    const effects = [setAnnotations.of(NO_ANNOTATIONS), setAnnotations.of(value)];
    expect(selectAnnotations(effects)).toBe(value);
    expect(selectAnnotations([])).toBeNull();
    expect(view.dom.querySelector('.cm-note-block')).toBeNull();
    view.dispatch({ effects });
    expect(view.dom.querySelector('[data-slot="n"]')).not.toBeNull();
    view.dispatch({ selection: { anchor: 1 } });
    view.dispatch({ changes: { from: 0, insert: 'zero\n' } });
    const block = view.dom.querySelector('.cm-note-block');
    expect(block?.previousElementSibling?.textContent).toBe('one');
  });
});

describe('SlotWidget', () => {
  it('shows the note’s element, ignores the editor’s events and gives it back when removed', () => {
    const registry = new SlotRegistry();
    const widget = new SlotWidget('n', registry);
    expect(widget.eq(new SlotWidget('n', registry))).toBe(true);
    expect(widget.eq(new SlotWidget('m', registry))).toBe(false);
    expect(widget.estimatedHeight).toBe(-1);
    registry.recordHeight('n', 80);
    expect(widget.estimatedHeight).toBe(80);
    const dom = widget.toDOM();
    expect(registry.select('n')?.parentElement).toBe(dom);
    expect(widget.ignoreEvent()).toBe(true);
    widget.destroy(dom);
    expect(registry.select('n')?.parentElement).toBeNull();
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
