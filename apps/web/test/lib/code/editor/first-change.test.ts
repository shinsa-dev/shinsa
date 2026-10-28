import { describe, expect, it } from 'bun:test';
import { Chunk } from '@codemirror/merge';
import { Text } from '@codemirror/state';
import {
  findFirstChangedLine,
  listBaselineChunks,
  resolveFirstChangeScroll,
  revealFirstChange,
} from '@/lib/code/editor/first-change.ts';
import { createView } from './support.ts';

const LINES = Array.from({ length: 200 }, (_, index) => `line ${index + 1}`);

function changeLine(number: number) {
  return LINES.map((line, index) => (index === number - 1 ? 'changed' : line)).join('\n');
}

function withHeight(element: HTMLElement, height: number) {
  Object.defineProperty(element, 'clientHeight', { configurable: true, value: height });
  return element;
}

function frame() {
  return new Promise((resolve) => setTimeout(resolve, 50));
}

describe('findFirstChangedLine', () => {
  it('names the line the first change starts on, or nothing when the file is unchanged', () => {
    const doc = Text.of(changeLine(120).split('\n'));
    expect(findFirstChangedLine(doc, listBaselineChunks(LINES.join('\n'), doc))).toBe(120);
    expect(findFirstChangedLine(doc, listBaselineChunks(changeLine(120), doc))).toBeNull();
    const removed = Text.of(LINES.slice(0, 199));
    expect(findFirstChangedLine(removed, Chunk.build(Text.of(LINES), removed))).toBe(199);
  });
});

describe('resolveFirstChangeScroll', () => {
  it('puts a change below the top half near the top, a few lines of context above it', () => {
    const view = createView(changeLine(120), []);
    const scroller = withHeight(view.scrollDOM, 400);
    const top = (line: number) => view.lineBlockAt(view.state.doc.line(line).from).top;
    expect(resolveFirstChangeScroll(view, scroller, 120)).toBe(view.documentTop + top(117));
    expect(resolveFirstChangeScroll(view, scroller, 999)).toBe(view.documentTop + top(197));
  });

  it('leaves a change already in the top half where it is', () => {
    const view = createView(changeLine(5), []);
    const scroller = withHeight(view.scrollDOM, 400);
    expect(resolveFirstChangeScroll(view, scroller, 5)).toBeNull();
    expect(resolveFirstChangeScroll(view, scroller, 1)).toBeNull();
    expect(resolveFirstChangeScroll(view, withHeight(view.scrollDOM, 0), 1)).toBe(0);
  });
});

describe('revealFirstChange', () => {
  it('scrolls once layout is measured, and only when the change is out of the top half', async () => {
    const far = createView(changeLine(120), []);
    withHeight(far.scrollDOM, 400);
    revealFirstChange(far, far.scrollDOM, 120);
    await frame();
    expect(far.scrollDOM.scrollTop).toBe(far.documentTop + far.lineBlockAt(far.state.doc.line(117).from).top);
    const near = createView(changeLine(5), []);
    withHeight(near.scrollDOM, 400);
    revealFirstChange(near, near.scrollDOM, 5);
    await frame();
    expect(near.scrollDOM.scrollTop).toBe(0);
  });
});
