import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { Button } from '@shinsa/ui/components/button';
import { Input } from '@shinsa/ui/components/input';
import { Switch } from '@shinsa/ui/components/switch';
import { Tabs, TabsList, TabsTrigger } from '@shinsa/ui/components/tabs';
import { Textarea } from '@shinsa/ui/components/textarea';
import { render } from '@testing-library/react';
import { ResizeHandle } from '@/components/layout/sidebar/resize-handle.tsx';
import { applyDesktop } from '@/lib/desktop.ts';
import { installDesktop } from './support/desktop.ts';

const DESKTOP_CSS = readFileSync(new URL('../src/desktop.css', import.meta.url), 'utf8').replace(
  /\s*\n\s*/g,
  ' '
);
const KIT_CURSORS = `
  button, a[href], [role="tab"], [role="treeitem"], [role="switch"], .cursor-pointer, button *, a[href] * { cursor: pointer; }
  button:disabled, input:disabled, textarea:disabled { cursor: not-allowed; }
  input, textarea, .cm-content { cursor: text; }
  input[type="checkbox"] { cursor: pointer; }
  .cursor-col-resize { cursor: col-resize; }
  .cursor-grab { cursor: grab; }
`;

let sheets: HTMLStyleElement[] = [];
let fake: ReturnType<typeof installDesktop> | null = null;
let stop: (() => void) | null = null;

function addSheet(css: string) {
  const sheet = document.createElement('style');
  sheet.textContent = css;
  document.head.append(sheet);
  sheets.push(sheet);
}

function renderClickables() {
  return render(
    <div>
      <Button>Approve</Button>
      <Button disabled>Merge</Button>
      <a href='/tasks/SW-1'>
        <span>SW-1</span>
      </a>
      <button type='button' className='cursor-pointer' style={{ cursor: 'pointer' }}>
        Inline
      </button>
      <div role='treeitem' aria-selected={false} tabIndex={0}>
        README.md
      </div>
      <Switch aria-label='Sound' />
      <Tabs defaultValue='a'>
        <TabsList>
          <TabsTrigger value='a'>Overview</TabsTrigger>
          <TabsTrigger value='b'>Chat</TabsTrigger>
        </TabsList>
      </Tabs>
      <ResizeHandle onPointerDown={() => undefined} onDoubleClick={() => undefined} />
      <button type='button' className='cursor-grab' aria-label='Drag the card'>
        Card
      </button>
      <Input aria-label='Title' />
      <Input aria-label='Branch' disabled />
      <input type='checkbox' aria-label='Done' />
      <Textarea aria-label='Message' />
      <div className='cm-content'>
        <div className='cm-line'>const a = 1;</div>
      </div>
    </div>
  );
}

function listPointers(container: HTMLElement) {
  return [container, ...container.querySelectorAll<HTMLElement>('*')].filter(
    (element) => getComputedStyle(element).cursor === 'pointer'
  );
}

function cursorOf(element: Element | null) {
  return getComputedStyle(element as HTMLElement).cursor;
}

beforeEach(() => {
  addSheet(KIT_CURSORS);
  addSheet(DESKTOP_CSS);
});

afterEach(() => {
  stop?.();
  stop = null;
  fake?.restore();
  fake = null;
  for (const sheet of sheets) sheet.remove();
  sheets = [];
});

describe('desktop.css', () => {
  it('leaves the pointer alone in a browser', () => {
    stop = applyDesktop(() => undefined);
    const { getByRole } = renderClickables();
    expect(cursorOf(getByRole('button', { name: 'Approve' }))).toBe('pointer');
    expect(cursorOf(getByRole('link', { name: 'SW-1' }))).toBe('pointer');
  });

  for (const windowState of ['window', 'fullscreen'] as const) {
    it(`replaces the pointer hand with the arrow in the Mac app (${windowState})`, () => {
      fake = installDesktop(windowState);
      stop = applyDesktop(() => undefined);
      const { container, getByRole } = renderClickables();
      expect(document.documentElement.dataset.desktop).toBe(windowState);
      expect(listPointers(container).map((element) => element.outerHTML.slice(0, 80))).toEqual([]);
      expect(cursorOf(getByRole('button', { name: 'Approve' }))).toBe('default');
      expect(cursorOf(getByRole('link', { name: 'SW-1' }))).toBe('default');
      expect(cursorOf(getByRole('link', { name: 'SW-1' }).firstElementChild)).toBe('default');
      expect(cursorOf(getByRole('button', { name: 'Inline' }))).toBe('default');
      expect(cursorOf(getByRole('treeitem'))).toBe('default');
      expect(cursorOf(getByRole('tab', { name: 'Chat' }))).toBe('default');
    });
  }

  it('keeps every other cursor: text, resize, grab and not-allowed', () => {
    fake = installDesktop();
    stop = applyDesktop(() => undefined);
    const { getByRole, getByLabelText, container } = renderClickables();
    expect(cursorOf(getByLabelText('Title'))).toBe('text');
    expect(cursorOf(getByLabelText('Message'))).toBe('text');
    expect(cursorOf(getByLabelText('Branch'))).toBe('not-allowed');
    expect(cursorOf(getByRole('button', { name: 'Merge' }))).toBe('not-allowed');
    expect(cursorOf(container.querySelector('.cm-content'))).toBe('text');
    expect(cursorOf(getByRole('button', { name: 'Resize the sidebar' }))).toBe('col-resize');
    expect(cursorOf(getByRole('button', { name: 'Drag the card' }))).toBe('grab');
    expect(cursorOf(getByLabelText('Done'))).toBe('default');
  });

  it('keeps the resize cursor across the page while a pane is dragged', () => {
    fake = installDesktop();
    stop = applyDesktop(() => undefined);
    const { getByRole } = renderClickables();
    document.body.style.cursor = 'col-resize';
    expect(cursorOf(getByRole('button', { name: 'Approve' }))).toBe('col-resize');
    document.body.style.removeProperty('cursor');
  });
});
