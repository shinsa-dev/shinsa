import { afterEach, describe, expect, it } from 'bun:test';
import { resolveSelectionRegion, SELECTABLE, scopeSelectAll } from '../../src/lib/selection';

function mount(html: string) {
  document.body.innerHTML = html;
}

function press(target: EventTarget, init: KeyboardEventInit = { key: 'a', metaKey: true }) {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  scopeSelectAll(event);
  return event;
}

function readSelected() {
  return document.getSelection()?.toString() ?? '';
}

afterEach(() => {
  document.getSelection()?.removeAllRanges();
  document.body.innerHTML = '';
});

describe('resolveSelectionRegion', () => {
  it('finds the outermost content region around a node, and none in chrome', () => {
    mount(
      `<div id="outer" class="${SELECTABLE}"><p id="inner" class="${SELECTABLE}">Prose</p></div><button id="chrome">Go</button>`
    );
    const prose = document.getElementById('inner')?.firstChild;
    expect(resolveSelectionRegion(prose)?.id).toBe('outer');
    expect(resolveSelectionRegion(document.getElementById('chrome'))).toBeNull();
    expect(resolveSelectionRegion(null)).toBeNull();
  });
});

describe('scopeSelectAll', () => {
  it('selects nothing in chrome, never the page', () => {
    mount(`<h2 id="title">Settings</h2><div class="${SELECTABLE}">Body</div>`);
    const event = press(document.getElementById('title') as HTMLElement);
    expect(event.defaultPrevented).toBe(true);
    expect(readSelected()).toBe('');
  });

  it('selects only the region the selection is in', () => {
    mount(`<h2>Review</h2><div id="note" class="${SELECTABLE}">A dropped connection</div><p>Footer</p>`);
    const note = document.getElementById('note') as HTMLElement;
    document.getSelection()?.collapse(note.firstChild as Node, 2);
    press(document.body);
    expect(readSelected()).toBe('A dropped connection');
  });

  it('falls back to the region the key was pressed in', () => {
    mount(`<pre id="code" class="${SELECTABLE}" tabindex="0">bun test</pre>`);
    press(document.getElementById('code') as HTMLElement, { key: 'A', ctrlKey: true });
    expect(readSelected()).toBe('bun test');
  });

  it('leaves fields, editors and terminals their own select all', () => {
    mount('<input id="field" value="draft" /><div class="cm-editor"><div id="line">x</div></div>');
    expect(press(document.getElementById('field') as HTMLElement).defaultPrevented).toBe(false);
    expect(press(document.getElementById('line') as HTMLElement).defaultPrevented).toBe(false);
  });

  it('ignores other keys and a key already handled', () => {
    mount('<p id="text">Hi</p>');
    const text = document.getElementById('text') as HTMLElement;
    expect(press(text, { key: 'a' }).defaultPrevented).toBe(false);
    expect(press(text, { key: 'a', metaKey: true, shiftKey: true }).defaultPrevented).toBe(false);
    expect(press(text, { key: 'c', metaKey: true }).defaultPrevented).toBe(false);
    const handled = new KeyboardEvent('keydown', { key: 'a', metaKey: true, cancelable: true });
    handled.preventDefault();
    scopeSelectAll(handled);
    expect(readSelected()).toBe('');
  });
});
