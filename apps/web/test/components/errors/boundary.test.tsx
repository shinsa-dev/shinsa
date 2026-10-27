import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { ErrorBoundary } from '@/components/errors/boundary.tsx';
import { ERROR_COPY, type ErrorFallbackSize } from '@/lib/errors.ts';
import { spyOnCommands } from '../../support/commands.ts';
import { findTooltipText } from '../../support/hover.ts';

const broken = { current: true };

function Widget() {
  if (broken.current) throw new TypeError('Cannot read properties of undefined (reading ‘filter’)');
  return <p>Services</p>;
}

function renderWidget(size: ErrorFallbackSize, resetKey = 'home') {
  const view = (key: string) => (
    <TooltipProvider>
      <p>Rail</p>
      <ErrorBoundary size={size} resetKey={key}>
        <Widget />
      </ErrorBoundary>
    </TooltipProvider>
  );
  const rendered = render(view(resetKey));
  return { ...rendered, rerenderWith: (key: string) => rendered.rerender(view(key)) };
}

let logged: ReturnType<typeof spyOn<Console, 'error'>>;

beforeEach(() => {
  broken.current = true;
  logged = spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  logged.mockRestore();
});

describe('an error boundary', () => {
  it('shows the fallback with the error’s message where the child was, and keeps what is outside it', () => {
    renderWidget('inline');
    expect(screen.getByRole('alert').textContent).toContain(ERROR_COPY.part);
    expect(screen.getByText('Cannot read properties of undefined (reading ‘filter’)')).toBeTruthy();
    expect(screen.getByText('Rail')).toBeTruthy();
    expect(screen.queryByText('Services')).toBeNull();
  });

  it('logs the error to the console with the component stack', () => {
    renderWidget('inline');
    const call = logged.mock.calls.find(
      (args: unknown[]) => args[0] === '[ErrorBoundary] A render error was caught'
    );
    expect(call?.[1]).toBeInstanceOf(TypeError);
    expect(String(call?.[2])).toContain('Widget');
  });

  it('renders the child again on Try again, once it no longer throws', () => {
    renderWidget('inline');
    fireEvent.click(screen.getByRole('button', { name: ERROR_COPY.retry }));
    expect(screen.getByRole('alert')).toBeTruthy();
    broken.current = false;
    fireEvent.click(screen.getByRole('button', { name: ERROR_COPY.retry }));
    expect(screen.getByText('Services')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('starts over when its reset key changes, as when you go to another page', () => {
    const view = renderWidget('page');
    expect(screen.getByText(ERROR_COPY.page)).toBeTruthy();
    expect(screen.getByText(ERROR_COPY.pageHint)).toBeTruthy();
    broken.current = false;
    view.rerenderWith('home');
    expect(screen.getByText(ERROR_COPY.page)).toBeTruthy();
    view.rerenderWith('tasks');
    expect(screen.getByText('Services')).toBeTruthy();
  });

  it('copies the message, the stack and the component stack with Copy details', async () => {
    const commands = spyOnCommands();
    renderWidget('inline');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: ERROR_COPY.copy }));
    });
    const copied = String(commands.copied.mock.calls[0]?.[0]);
    expect(copied).toContain('Cannot read properties of undefined');
    expect(copied).toContain('Component stack:');
    expect(copied).toContain('Widget');
    commands.restore();
  });

  it('shows a small warning button on a trigger, whose tooltip has the message and whose popover can try again', async () => {
    renderWidget('icon');
    const button = screen.getByRole('alert');
    expect(button.getAttribute('aria-label')).toBe(ERROR_COPY.part);
    expect(await findTooltipText(button)).toContain('Cannot read properties of undefined');
    await act(async () => {
      fireEvent.click(button);
    });
    broken.current = false;
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: ERROR_COPY.retry }));
    });
    expect(screen.getByText('Services')).toBeTruthy();
  });

  it('renders nothing in its place when silent, and tells the caller', () => {
    const errors: string[] = [];
    render(
      <>
        <p>Rail</p>
        <ErrorBoundary size='silent' onError={(error) => errors.push(error.message)}>
          <Widget />
        </ErrorBoundary>
      </>
    );
    expect(screen.getByText('Rail')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(errors).toEqual(['Cannot read properties of undefined (reading ‘filter’)']);
  });
});
