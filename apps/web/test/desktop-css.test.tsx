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

const DESKTOP_CSS = readFileSync(new URL('../src/desktop.css', import.meta.url), 'utf8');
const POINTER_EVERYWHERE = '*, .cursor-pointer, [role="treeitem"], a[href], button { cursor: pointer; }';

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
      <a href='/tasks/SW-1'>SW-1</a>
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

beforeEach(() => {
  addSheet(POINTER_EVERYWHERE);
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
    expect(getComputedStyle(getByRole('button', { name: 'Approve' })).cursor).toBe('pointer');
  });

  for (const windowState of ['window', 'fullscreen'] as const) {
    it(`shows no pointer anywhere in the Mac app (${windowState})`, () => {
      fake = installDesktop(windowState);
      stop = applyDesktop(() => undefined);
      const { container } = renderClickables();
      expect(document.documentElement.dataset.desktop).toBe(windowState);
      expect(listPointers(container).map((element) => element.outerHTML.slice(0, 80))).toEqual([]);
      expect(getComputedStyle(document.documentElement).cursor).toBe('default');
    });
  }

  it('keeps the text cursor in inputs and the editor, and the resize cursor on a handle', () => {
    fake = installDesktop();
    stop = applyDesktop(() => undefined);
    const { getByRole, getByLabelText, container } = renderClickables();
    expect(getComputedStyle(getByRole('button', { name: 'Approve' })).cursor).toBe('default');
    expect(getComputedStyle(getByRole('link', { name: 'SW-1' })).cursor).toBe('default');
    expect(getComputedStyle(getByLabelText('Title')).cursor).toBe('text');
    expect(getComputedStyle(getByLabelText('Message')).cursor).toBe('text');
    expect(getComputedStyle(getByLabelText('Branch')).cursor).toBe('default');
    expect(getComputedStyle(getByLabelText('Done')).cursor).toBe('default');
    expect(getComputedStyle(container.querySelector('.cm-line') as HTMLElement).cursor).toBe('text');
    expect(getComputedStyle(getByRole('button', { name: 'Resize the sidebar' })).cursor).toBe('col-resize');
  });

  it('keeps the resize cursor across the page while a pane is dragged', () => {
    fake = installDesktop();
    stop = applyDesktop(() => undefined);
    const { getByRole } = renderClickables();
    document.body.style.cursor = 'col-resize';
    expect(getComputedStyle(getByRole('button', { name: 'Approve' })).cursor).toBe('col-resize');
    document.body.style.removeProperty('cursor');
  });
});
