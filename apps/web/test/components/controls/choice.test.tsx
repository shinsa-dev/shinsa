import { describe, expect, it } from 'bun:test';
import { render } from '@testing-library/react';
import { Choice, revealActiveItem } from '@/components/controls/choice.tsx';

const ITEMS = [
  { value: 'general', label: 'General' },
  { value: 'projects', label: 'Projects' },
  { value: 'automations', label: 'Automations' },
] as const;

function placeAt(element: Element, left: number, right: number) {
  element.getBoundingClientRect = () => ({ left, right }) as DOMRect;
}

function createStrip(itemLeft: number, itemRight: number, scrollLeft = 0) {
  const strip = document.createElement('div');
  const item = document.createElement('button');
  item.setAttribute('data-active', '');
  strip.append(item);
  placeAt(strip, 0, 200);
  placeAt(item, itemLeft, itemRight);
  strip.scrollLeft = scrollLeft;
  return strip;
}

describe('revealActiveItem', () => {
  it('scrolls the strip forward to an item past its end', () => {
    const strip = createStrip(250, 330);
    revealActiveItem(strip);
    expect(strip.scrollLeft).toBe(130);
  });

  it('scrolls the strip back to an item before its start', () => {
    const strip = createStrip(-40, 30, 100);
    revealActiveItem(strip);
    expect(strip.scrollLeft).toBe(60);
  });

  it('leaves the strip alone when the item is in view or none is active', () => {
    const strip = createStrip(20, 90, 10);
    revealActiveItem(strip);
    expect(strip.scrollLeft).toBe(10);
    const empty = document.createElement('div');
    revealActiveItem(empty);
    expect(empty.scrollLeft).toBe(0);
  });
});

describe('Choice', () => {
  it('scrolls its tabs inside the strip, never the strip, when it scrolls', () => {
    const view = render(
      <Choice
        label='Settings sections'
        items={[...ITEMS]}
        value='automations'
        onValueChange={() => {}}
        scrolls
      />
    );
    const list = view.getByRole('tablist', { name: 'Settings sections' });
    expect(list.className).toContain('overflow-x-auto');
    expect(list.parentElement?.className).not.toContain('overflow-x-auto');
    expect(list.parentElement?.className).toContain('bg-bg-2');
    expect(list.className).toContain('bg-transparent');
    expect(list.classList.contains('scroll-fade')).toBe(true);
    expect(list.getAttribute('data-fade-orientation')).toBe('horizontal');
    view.unmount();
  });

  it('leaves the strip as it is when it does not scroll', () => {
    const view = render(
      <Choice label='Task view' items={[...ITEMS]} value='automations' onValueChange={() => {}} />
    );
    const list = view.getByRole('tablist', { name: 'Task view' });
    expect(list.className).not.toContain('overflow-x-auto');
    expect(list.classList.contains('scroll-fade')).toBe(false);
    view.unmount();
  });
});
