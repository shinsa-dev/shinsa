import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as React from 'react';
import {
  Tooltip,
  TooltipContent,
  TooltipLabel,
  TooltipProvider,
  TooltipTrigger,
  useTooltipTrigger,
} from '../../src/components/tooltip';
import { flush } from '../support/layout';
import { installMedia } from '../support/media';

let media: ReturnType<typeof installMedia>;

beforeEach(() => {
  media = installMedia({ '(hover: hover)': true });
});

afterEach(() => media.restore());

function Hint(props: { onClick?: () => void; delay?: number }) {
  return (
    <TooltipProvider>
      <Tooltip delay={props.delay}>
        <TooltipTrigger onClick={props.onClick}>Info</TooltipTrigger>
        <TooltipContent>
          Merged <TooltipLabel>2h ago</TooltipLabel>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function Labelled({ label, tip }: { label: string; tip: string | null }) {
  return useTooltipTrigger(<button type='button'>{label}</button>, tip ? { content: tip } : null);
}

const tooltip = () => document.querySelector<HTMLElement>('[data-slot="tooltip-content"]');

async function settle() {
  await act(async () => {
    await flush();
  });
}

async function hover(element: Element, init: PointerEventInit = {}) {
  await act(async () => {
    fireEvent.pointerOver(element, { pointerType: 'mouse', ...init });
    await flush();
  });
}

async function tap(element: Element) {
  await act(async () => {
    fireEvent.pointerDown(element, { pointerType: 'touch' });
    fireEvent.click(element);
    await flush();
  });
}

async function waitClosed() {
  await waitFor(() => expect(tooltip()?.hasAttribute('data-open') ?? false).toBe(false));
}

describe('Tooltip on a device with hover', () => {
  it('opens over its trigger on hover, says what it is and names the trigger’s description', async () => {
    render(<Hint />);
    const trigger = screen.getByRole('button', { name: 'Info' });
    expect(trigger.dataset.slot).toBe('tooltip-trigger');
    expect(trigger.hasAttribute('data-tooltip-trigger')).toBe(true);

    await hover(trigger);
    expect(tooltip()?.textContent).toBe('Merged 2h ago');
    expect(screen.getByText('2h ago').dataset.slot).toBe('tooltip-label');
    expect(trigger.getAttribute('aria-describedby')).toBe(tooltip()?.id ?? '');
    expect(trigger.hasAttribute('data-popup-open')).toBe(true);
  });

  it('closes when the pointer leaves for the rest of the page, and forgets the marks it set', async () => {
    render(
      <>
        <Hint />
        <p>Elsewhere</p>
      </>
    );
    const trigger = screen.getByRole('button', { name: 'Info' });
    await hover(trigger);
    await hover(screen.getByText('Elsewhere'));
    await waitClosed();
    expect(trigger.hasAttribute('aria-describedby')).toBe(false);
    expect(trigger.hasAttribute('data-popup-open')).toBe(false);
  });

  it('stays open while the pointer moves inside the trigger or over the tooltip', async () => {
    render(
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger render={<span />}>
            <b>Bold</b> rest
          </TooltipTrigger>
          <TooltipContent>Detail</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
    await hover(screen.getByText('Bold'));
    await hover(screen.getByText('Bold').parentElement as HTMLElement);
    await hover(tooltip() as HTMLElement);
    expect(tooltip()?.hasAttribute('data-open')).toBe(true);
  });

  it('closes when the pointer leaves the window, on Escape and on a press of its trigger', async () => {
    render(<Hint />);
    const trigger = screen.getByRole('button', { name: 'Info' });

    await hover(trigger);
    await act(async () => {
      fireEvent.pointerOut(trigger, { pointerType: 'mouse', relatedTarget: null });
      await flush();
    });
    await waitClosed();

    await hover(document.body);
    await hover(trigger);
    await act(async () => {
      fireEvent.keyDown(trigger, { key: 'Escape' });
      await flush();
    });
    await waitClosed();

    await hover(document.body);
    await hover(trigger);
    await act(async () => {
      fireEvent.pointerDown(trigger, { pointerType: 'mouse' });
      await flush();
    });
    await waitClosed();
  });

  it('stays closed after a press or Escape until the pointer leaves its trigger and comes back', async () => {
    render(
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger>
            <b>Icon</b> Label
          </TooltipTrigger>
          <TooltipContent>Detail</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
    const trigger = screen.getByRole('button', { name: 'Icon Label' });
    await hover(trigger);
    await act(async () => {
      fireEvent.pointerDown(trigger, { pointerType: 'mouse' });
      await flush();
    });
    await hover(screen.getByText('Icon'));
    await waitClosed();

    await act(async () => {
      fireEvent.pointerOut(trigger, { pointerType: 'mouse', relatedTarget: null });
      await flush();
    });
    await hover(trigger);
    expect(tooltip()?.hasAttribute('data-open')).toBe(true);

    await act(async () => {
      fireEvent.keyDown(trigger, { key: 'Escape' });
      await flush();
    });
    await hover(trigger);
    await waitClosed();
    await hover(document.body);
    await hover(trigger);
    expect(tooltip()?.hasAttribute('data-open')).toBe(true);
  });

  it('waits the delay before it opens, and a move away before then opens nothing', async () => {
    render(
      <>
        <Hint delay={30} />
        <p>Elsewhere</p>
      </>
    );
    const trigger = screen.getByRole('button', { name: 'Info' });
    await hover(trigger);
    expect(tooltip()).toBeNull();
    await hover(screen.getByText('Elsewhere'));
    await settle();
    await act(() => Bun.sleep(40));
    expect(tooltip()).toBeNull();

    await hover(trigger);
    await waitFor(() => expect(tooltip()?.textContent).toBe('Merged 2h ago'));
  });

  it('takes the delay of the nearest provider', async () => {
    render(
      <TooltipProvider>
        <TooltipProvider delay={30}>
          <Labelled label='Slow' tip='Slow tip' />
        </TooltipProvider>
        <TooltipProvider>
          <Labelled label='Quick' tip='Quick tip' />
        </TooltipProvider>
      </TooltipProvider>
    );
    await hover(screen.getByRole('button', { name: 'Slow' }));
    expect(tooltip()).toBeNull();
    await waitFor(() => expect(tooltip()?.textContent).toBe('Slow tip'));
    await hover(screen.getByRole('button', { name: 'Quick' }));
    expect(tooltip()?.textContent).toBe('Quick tip');
  });

  it('moves straight to the next trigger and opens the innermost of nested ones', async () => {
    render(
      <TooltipProvider>
        <Labelled label='One' tip='First' />
        <Tooltip>
          <TooltipTrigger render={<span />}>
            Outer <Labelled label='Inner' tip='Inner tip' />
          </TooltipTrigger>
          <TooltipContent>Outer tip</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
    await hover(screen.getByRole('button', { name: 'One' }));
    expect(tooltip()?.textContent).toBe('First');
    await hover(screen.getByRole('button', { name: 'Inner' }));
    expect(tooltip()?.textContent).toBe('Inner tip');
    await hover(screen.getByText('Outer'));
    expect(tooltip()?.textContent).toBe('Outer tip');
  });

  it('ignores touch hovers and taps', async () => {
    render(<Hint />);
    const trigger = screen.getByRole('button', { name: 'Info' });
    await hover(trigger, { pointerType: 'touch' });
    await tap(trigger);
    expect(tooltip()).toBeNull();
  });

  it('shows new content while open and closes when its trigger goes away', async () => {
    const view = render(
      <TooltipProvider>
        <Labelled label='Copy' tip='Copy' />
      </TooltipProvider>
    );
    await hover(screen.getByRole('button', { name: 'Copy' }));
    view.rerender(
      <TooltipProvider>
        <Labelled label='Copy' tip='Copied' />
      </TooltipProvider>
    );
    await settle();
    expect(tooltip()?.textContent).toBe('Copied');

    view.rerender(
      <TooltipProvider>
        <Labelled label='Copy' tip={null} />
      </TooltipProvider>
    );
    await waitClosed();
    expect(screen.getByRole('button', { name: 'Copy' }).hasAttribute('data-tooltip-trigger')).toBe(false);

    view.rerender(
      <TooltipProvider>
        <Labelled label='Copy' tip='Copy' />
      </TooltipProvider>
    );
    await hover(document.body);
    await hover(screen.getByRole('button', { name: 'Copy' }));
    view.rerender(<TooltipProvider>{null}</TooltipProvider>);
    await waitClosed();
  });

  it('leaves an element without a tooltip alone, and without a provider opens nothing', async () => {
    render(
      <>
        <TooltipProvider>
          <Labelled label='Plain' tip={null} />
        </TooltipProvider>
        <Labelled label='Orphan' tip='Never' />
      </>
    );
    await hover(screen.getByRole('button', { name: 'Plain' }));
    await hover(screen.getByRole('button', { name: 'Orphan' }));
    expect(tooltip()).toBeNull();
  });

  it('follows the pointer down its trigger when asked to', async () => {
    render(
      <TooltipProvider>
        <Tooltip trackCursorAxis='y'>
          <TooltipTrigger render={<span />}>Edge</TooltipTrigger>
          <TooltipContent side='right'>Drag to resize</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
    const edge = screen.getByText('Edge');
    await hover(edge, { clientY: 40 });
    expect(tooltip()?.textContent).toBe('Drag to resize');
    await act(async () => {
      fireEvent.pointerMove(edge, { pointerType: 'mouse', clientY: 80 });
      fireEvent.pointerMove(document.body, { pointerType: 'mouse', clientY: 90 });
      await new Promise((resolve) => requestAnimationFrame(resolve));
      await flush();
    });
    expect(tooltip()?.textContent).toBe('Drag to resize');
  });
});

describe('Tooltip from the keyboard', () => {
  it('opens on keyboard focus and closes when focus leaves, but not on a focus from a press', async () => {
    render(
      <TooltipProvider>
        <Labelled label='One' tip='First' />
        <Labelled label='Two' tip='Second' />
        <input aria-label='Field' />
      </TooltipProvider>
    );
    const one = screen.getByRole('button', { name: 'One' });
    await act(async () => {
      fireEvent.keyDown(document.body, { key: 'Tab' });
      one.focus();
      await flush();
    });
    expect(tooltip()?.textContent).toBe('First');

    await act(async () => {
      screen.getByRole('button', { name: 'Two' }).focus();
      await flush();
    });
    expect(tooltip()?.textContent).toBe('Second');

    await act(async () => {
      screen.getByRole('textbox', { name: 'Field' }).focus();
      await flush();
    });
    await waitClosed();

    await act(async () => {
      fireEvent.pointerDown(one, { pointerType: 'mouse' });
      one.focus();
      await flush();
    });
    await waitClosed();
  });
});

describe('Tooltip without hover', () => {
  beforeEach(() => media.flip('(hover: hover)', false));

  it('opens and closes on tap, and still runs the trigger’s own click', async () => {
    const onClick = mock();
    render(<Hint onClick={onClick} />);
    const trigger = screen.getByRole('button', { name: 'Info' });

    await tap(trigger);
    expect(screen.getByText('2h ago').dataset.slot).toBe('tooltip-label');
    expect(onClick).toHaveBeenCalledTimes(1);

    await tap(trigger);
    await waitClosed();
  });

  it('closes on a tap elsewhere, but not on a tap inside the tooltip', async () => {
    render(
      <>
        <Hint />
        <p>Elsewhere</p>
      </>
    );
    await tap(screen.getByRole('button', { name: 'Info' }));
    await tap(tooltip() as HTMLElement);
    expect(tooltip()?.hasAttribute('data-open')).toBe(true);
    await tap(screen.getByText('Elsewhere'));
    await waitClosed();
  });
});

describe('TooltipTrigger', () => {
  it('runs the rendered element’s own handlers and the trigger’s, and keeps both refs', () => {
    const own = mock();
    const extra = mock();
    const renderRef = React.createRef<HTMLButtonElement>();
    const cleanup = mock();
    const callbackRef = mock((_node: HTMLButtonElement | null) => cleanup);
    const view = render(
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger
            ref={callbackRef}
            onClick={extra}
            render={<button type='button' ref={renderRef} onClick={own} data-slot='own' />}
          >
            Act
          </TooltipTrigger>
          <TooltipContent>Acts</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
    const button = screen.getByRole('button', { name: 'Act' });
    fireEvent.click(button);
    expect(own).toHaveBeenCalledTimes(1);
    expect(extra).toHaveBeenCalledTimes(1);
    expect(button.dataset.slot).toBe('own');
    expect(callbackRef).toHaveBeenCalledWith(button);
    view.unmount();
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('clears an object ref and a callback ref without a cleanup when it unmounts', () => {
    const objectRef = React.createRef<HTMLButtonElement>();
    const calls: (HTMLButtonElement | null)[] = [];
    const view = render(
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger ref={objectRef}>Object</TooltipTrigger>
          <TooltipTrigger
            ref={(node) => {
              calls.push(node);
            }}
          >
            Callback
          </TooltipTrigger>
        </Tooltip>
      </TooltipProvider>
    );
    expect(objectRef.current?.textContent).toBe('Object');
    view.unmount();
    expect(objectRef.current).toBeNull();
    expect(calls.at(-1)).toBeNull();
  });

  it('opens nothing without content or outside a Tooltip', async () => {
    render(
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger>Empty</TooltipTrigger>
        </Tooltip>
        <TooltipTrigger>Alone</TooltipTrigger>
      </TooltipProvider>
    );
    await hover(screen.getByRole('button', { name: 'Empty' }));
    await hover(screen.getByRole('button', { name: 'Alone' }));
    expect(tooltip()).toBeNull();
    expect(screen.getByRole('button', { name: 'Alone' }).hasAttribute('data-tooltip-trigger')).toBe(false);
  });
});
