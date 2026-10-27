import { describe, expect, it } from 'bun:test';
import { act, render } from '@testing-library/react';
import * as React from 'react';
import { INDICATOR_TRANSITION, useAnimatedIndicator } from '../../src/hooks/use-animated-indicator';
import { flush, place } from '../support/layout';

type Options = Parameters<typeof useAnimatedIndicator>[1];

function List({ options, children, bare }: { options?: Options; children: React.ReactNode; bare?: boolean }) {
  const root = React.useRef<HTMLDivElement>(null);
  const indicator = useAnimatedIndicator(root, options);
  return (
    <div ref={root} data-testid='root'>
      {bare ? null : <div ref={indicator} data-testid='indicator' />}
      {children}
    </div>
  );
}

function Sized() {
  const root = React.useRef<HTMLDivElement>(null);
  const indicator = useAnimatedIndicator(root);
  const measure = (box: { top: number; height: number }) => (element: HTMLDivElement | null) => {
    if (element)
      place(element, {
        offsetLeft: 4,
        offsetTop: box.top,
        offsetWidth: 100,
        offsetHeight: box.height,
        offsetParent: null,
      });
  };
  return (
    <div ref={root}>
      <div ref={indicator} data-testid='indicator' />
      <div ref={measure({ top: 4, height: 24 })} data-testid='short' data-highlighted='' />
      <div ref={measure({ top: 30, height: 40 })} data-testid='tall' />
    </div>
  );
}

function setup(ui: React.ReactElement) {
  const view = render(ui);
  return { ...view, indicator: view.getByTestId('indicator'), root: view.getByTestId('root') };
}

function items(attribute = 'data-highlighted') {
  return [
    <div key='a' data-testid='a' {...{ [attribute]: '' }} />,
    <div key='b' data-testid='b' data-variant='destructive' />,
  ];
}

function Watched({ trail, children }: { trail: string[][]; children: React.ReactNode }) {
  const root = React.useRef<HTMLDivElement>(null);
  const indicator = useAnimatedIndicator(root, { parkWhenEmpty: true });
  const watch = (element: HTMLDivElement | null) => {
    indicator.current = element;
    if (!element) return;
    const styles: string[] = [];
    trail.push(styles);
    new MutationObserver((records) => {
      for (const record of records) styles.push(record.oldValue ?? '');
    }).observe(element, { attributes: true, attributeFilter: ['style'], attributeOldValue: true });
  };
  return (
    <div ref={root}>
      <div ref={watch} data-testid='indicator' />
      {children}
    </div>
  );
}

function firstShown(styles: string[], last: string) {
  return [...styles, last].find((style) => style.includes('opacity: 1'));
}

describe('useAnimatedIndicator', () => {
  it('shows the item marked when it mounts at once: no fade and no slide', async () => {
    const trail: string[][] = [];
    const view = render(<Watched trail={trail}>{items()}</Watched>);
    const indicator = view.getByTestId('indicator');
    await act(flush);
    expect(firstShown(trail[0] ?? [], indicator.getAttribute('style') ?? '')).toContain('transition: none');
    expect(indicator.style.transition).toBe(INDICATOR_TRANSITION);
  });

  it('fades in when an item is marked again after it parked', async () => {
    const trail: string[][] = [];
    const view = render(<Watched trail={trail}>{items()}</Watched>);
    const indicator = view.getByTestId('indicator');
    const a = view.getByTestId('a');
    a.removeAttribute('data-highlighted');
    await act(flush);
    expect(indicator.style.opacity).toBe('0');
    const styles = trail[0] ?? [];
    styles.length = 0;
    a.setAttribute('data-highlighted', '');
    await act(flush);
    expect(firstShown(styles, indicator.getAttribute('style') ?? '')).toContain(
      `transition: ${INDICATOR_TRANSITION}`
    );
  });

  it('lands on the marked item without travelling', () => {
    const { indicator, getByTestId } = setup(<List>{items()}</List>);
    expect(getByTestId('a').hasAttribute('data-indicator-here')).toBe(true);
    expect(indicator.style.opacity).toBe('1');
    expect(indicator.style.transition).toBe(INDICATOR_TRANSITION);
    expect(indicator.style.transform).toBe('translate(0px, 0px) scale(1, 1) scale(var(--hl-press-scale, 1))');
  });

  it('slides to the next marked item and mirrors its variant', async () => {
    const { indicator, getByTestId } = setup(<List>{items()}</List>);
    const a = getByTestId('a');
    const b = getByTestId('b');
    place(b, { offsetLeft: 0, offsetTop: 28, offsetWidth: 120, offsetHeight: 24, offsetParent: null });

    a.removeAttribute('data-highlighted');
    b.setAttribute('data-highlighted', '');
    await act(flush);

    expect(a.hasAttribute('data-indicator-here')).toBe(false);
    expect(b.hasAttribute('data-indicator-here')).toBe(true);
    expect(indicator.getAttribute('data-variant')).toBe('destructive');
    expect(indicator.style.transform).toBe(
      'translate(0px, 28px) scale(1, 1) scale(var(--hl-press-scale, 1))'
    );
    expect(indicator.style.width).toBe('120px');
    expect(indicator.style.height).toBe('24px');

    b.removeAttribute('data-highlighted');
    a.setAttribute('data-highlighted', '');
    await act(flush);
    expect(indicator.hasAttribute('data-variant')).toBe(false);
  });

  it('slides onto an item of another size by scaling, never by laying itself out', async () => {
    const measured = render(<Sized />);
    const indicator = measured.getByTestId('indicator');
    expect(indicator.style.width).toBe('100px');
    expect(indicator.style.height).toBe('24px');
    expect(indicator.style.transform).toBe('translate(4px, 4px) scale(1, 1) scale(var(--hl-press-scale, 1))');

    const tall = measured.getByTestId('tall');
    measured.getByTestId('short').removeAttribute('data-highlighted');
    tall.setAttribute('data-highlighted', '');
    await act(flush);
    expect(indicator.style.width).toBe('100px');
    expect(indicator.style.height).toBe('24px');
    expect(indicator.style.transform).toBe(
      'translate(4px, 38px) scale(1, 1.6666666666666667) scale(var(--hl-press-scale, 1))'
    );
    expect(indicator.style.transition).toBe(INDICATOR_TRANSITION);
  });

  it('lays itself out at the new size once the slide ends, with no transition', async () => {
    const measured = render(<Sized />);
    const indicator = measured.getByTestId('indicator');
    measured.getByTestId('short').removeAttribute('data-highlighted');
    measured.getByTestId('tall').setAttribute('data-highlighted', '');
    await act(flush);

    const end = (propertyName: string, target: Element = indicator) => {
      const event = new Event('transitionend', { bubbles: true });
      Object.defineProperty(event, 'propertyName', { value: propertyName });
      target.dispatchEvent(event);
    };
    const seen: string[] = [];
    const write = indicator.style.setProperty.bind(indicator.style);
    indicator.style.setProperty = (name, value) => {
      if (name === 'height') seen.push(indicator.style.transition);
      write(name, value);
    };

    end('opacity');
    end('transform', measured.getByTestId('tall'));
    expect(indicator.style.height).toBe('24px');

    end('transform');
    expect(indicator.style.height).toBe('40px');
    expect(indicator.style.transform).toBe(
      'translate(4px, 30px) scale(1, 1) scale(var(--hl-press-scale, 1))'
    );
    expect(indicator.style.transition).toBe(INDICATOR_TRANSITION);

    end('transform');
    expect(indicator.style.height).toBe('40px');
    expect(seen.every((transition) => transition === 'none')).toBe(true);
  });

  it('adds up offsets through positioned wrappers inside the list, and stops at its edge', async () => {
    const view = setup(
      <List>
        <section data-testid='group'>
          <div data-testid='item' />
        </section>
      </List>
    );
    const group = view.getByTestId('group');
    const item = view.getByTestId('item');
    place(group, { offsetLeft: 2, offsetTop: 40, offsetParent: document.body });
    place(item, { offsetLeft: 4, offsetTop: 6, offsetWidth: 80, offsetHeight: 24, offsetParent: group });

    item.setAttribute('data-highlighted', '');
    await act(flush);
    expect(view.indicator.style.transform).toBe(
      'translate(6px, 46px) scale(1, 1) scale(var(--hl-press-scale, 1))'
    );
  });

  it('matches an attribute value when one is given', () => {
    const { getByTestId } = setup(
      <List options={{ attribute: 'data-selected', value: 'true' }}>
        <div data-testid='a' data-selected='false' />
        <div data-testid='b' data-selected='true' />
      </List>
    );
    expect(getByTestId('a').hasAttribute('data-indicator-here')).toBe(false);
    expect(getByTestId('b').hasAttribute('data-indicator-here')).toBe(true);
  });

  it('parks when nothing is marked, if asked to', async () => {
    const { indicator, getByTestId } = setup(<List options={{ parkWhenEmpty: true }}>{items()}</List>);
    getByTestId('a').removeAttribute('data-highlighted');
    await act(flush);
    expect(indicator.style.opacity).toBe('0');
    expect(indicator.style.width).toBe('0px');
    expect(getByTestId('a').hasAttribute('data-indicator-here')).toBe(false);
  });

  it('otherwise stays on the last item until that item leaves the list', async () => {
    const view = setup(<List>{items()}</List>);
    view.getByTestId('a').removeAttribute('data-highlighted');
    await act(flush);
    expect(view.indicator.style.opacity).toBe('1');

    view.rerender(<List>{[]}</List>);
    await act(flush);
    expect(view.indicator.style.opacity).toBe('0');
  });

  it('deflates by the press inset while an item is held, and restores on release', async () => {
    const { indicator, getByTestId, root } = setup(<List>{items()}</List>);
    place(getByTestId('a'), { offsetWidth: 100, offsetHeight: 20 });
    getByTestId('a').setAttribute('data-highlighted', 'again');
    await act(flush);

    getByTestId('b').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(indicator.style.getPropertyValue('--hl-press-scale')).toBe('');

    getByTestId('a').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(indicator.style.getPropertyValue('--hl-press-scale')).toBe('0.98, 0.95');

    document.dispatchEvent(new PointerEvent('pointerup'));
    expect(indicator.style.getPropertyValue('--hl-press-scale')).toBe('');

    root.style.setProperty('--press-inset-x', '5px');
    root.style.setProperty('--press-inset-y', '2px');
    getByTestId('a').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    getByTestId('a').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(indicator.style.getPropertyValue('--hl-press-scale')).toBe('0.9, 0.8');
    document.dispatchEvent(new PointerEvent('pointercancel'));
    expect(indicator.style.getPropertyValue('--hl-press-scale')).toBe('');
  });

  it('lands the press and its release with no transition, keeping the slide for the next move', () => {
    const { indicator, getByTestId } = setup(<List>{items()}</List>);
    expect(indicator.style.transition).toBe(INDICATOR_TRANSITION);
    const seen: string[] = [];
    const write = indicator.style.setProperty.bind(indicator.style);
    const remove = indicator.style.removeProperty.bind(indicator.style);
    indicator.style.setProperty = (name, value) => {
      if (name === '--hl-press-scale') seen.push(`press ${indicator.style.transition}`);
      write(name, value);
    };
    indicator.style.removeProperty = (name) => {
      if (name === '--hl-press-scale') seen.push(`release ${indicator.style.transition}`);
      return remove(name);
    };

    getByTestId('a').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    document.dispatchEvent(new PointerEvent('pointerup'));

    expect(seen).toEqual(['press none', 'release none']);
    expect(indicator.style.transition).toBe(INDICATOR_TRANSITION);
  });

  it('does not deflate an unmeasured indicator, or at all without press', () => {
    const pressed = setup(<List>{items()}</List>);
    pressed.getByTestId('a').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(pressed.indicator.style.getPropertyValue('--hl-press-scale')).toBe('1, 1');
    pressed.unmount();

    const still = setup(<List options={{ press: false }}>{items()}</List>);
    still.getByTestId('a').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(still.indicator.style.getPropertyValue('--hl-press-scale')).toBe('');
  });

  it('cleans up after itself', () => {
    const { getByTestId, unmount } = setup(<List>{items()}</List>);
    const a = getByTestId('a');
    unmount();
    expect(a.hasAttribute('data-indicator-here')).toBe(false);
  });

  it('does nothing without an indicator to move', () => {
    const view = render(<List bare>{items()}</List>);
    expect(view.getByTestId('a').hasAttribute('data-indicator-here')).toBe(false);
  });
});
