import { afterEach, describe, expect, it, mock } from 'bun:test';
import { render } from '@testing-library/react';
import { Choice } from '@/components/controls/choice.tsx';

const ITEMS = [
  { value: 'general', label: 'General' },
  { value: 'projects', label: 'Projects' },
  { value: 'automations', label: 'Automations' },
] as const;

const original = Element.prototype.scrollIntoView;

afterEach(() => {
  Element.prototype.scrollIntoView = original;
});

function spyOnScrollIntoView() {
  const revealed: string[] = [];
  const spy = mock(function (this: Element) {
    revealed.push(this.textContent ?? '');
  });
  Element.prototype.scrollIntoView = spy;
  return { revealed, spy };
}

describe('Choice', () => {
  it('scrolls its strip and keeps the active item in view when it scrolls', () => {
    const { revealed, spy } = spyOnScrollIntoView();
    const view = render(
      <Choice label='Settings sections' items={[...ITEMS]} value='automations' onValueChange={() => {}} scrolls />
    );
    const strip = view.getByRole('tablist', { name: 'Settings sections' }).parentElement;
    expect(strip?.className).toContain('overflow-x-auto');
    expect(revealed).toEqual(['Automations']);
    expect(spy.mock.calls[0]).toEqual([{ block: 'nearest', inline: 'nearest' }]);
    view.rerender(
      <Choice label='Settings sections' items={[...ITEMS]} value='projects' onValueChange={() => {}} scrolls />
    );
    expect(revealed).toEqual(['Automations', 'Projects']);
    view.unmount();
  });

  it('leaves the strip and the page alone when it does not scroll', () => {
    const { spy } = spyOnScrollIntoView();
    const view = render(
      <Choice label='Task view' items={[...ITEMS]} value='automations' onValueChange={() => {}} />
    );
    expect(view.getByRole('tablist', { name: 'Task view' }).parentElement?.className).not.toContain(
      'overflow-x-auto'
    );
    expect(spy).not.toHaveBeenCalled();
    view.unmount();
  });
});
