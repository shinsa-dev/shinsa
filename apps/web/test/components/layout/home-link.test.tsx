import { afterEach, describe, expect, it } from 'bun:test';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { CardsTopBar } from '@/components/layout/cards/top-bar.tsx';
import { HomeLink } from '@/components/layout/home-link.tsx';
import { DesktopChrome } from '@/lib/desktop.ts';
import { navigate, parseRoute, RouteScope } from '@/router.ts';
import { installDesktop } from '../../support/desktop.ts';
import { findTooltipText } from '../../support/hover.ts';
import { createShinsaState, createTask } from '../../support/state.ts';

const STATE = createShinsaState({
  tasks: [createTask({ id: 'task', handle: 'SW-1', title: 'Fix the login' })],
});

let fake: ReturnType<typeof installDesktop> | null = null;

afterEach(() => {
  fake?.restore();
  fake = null;
});

describe('the way home', () => {
  it('is the Shinsa wordmark in a browser', () => {
    act(() => navigate('/tasks/SW-1'));
    render(
      <TooltipProvider>
        <HomeLink />
      </TooltipProvider>
    );
    expect(screen.queryByRole('button', { name: 'Home' })).toBeNull();
    act(() => fireEvent.click(screen.getByRole('button', { name: /Shinsa/ })));
    expect(location.pathname).toBe('/');
  });

  it('is a Home button with its menu shortcut in the Mac app, never the wordmark', async () => {
    fake = installDesktop();
    act(() => navigate('/tasks/SW-1'));
    let navigated = 0;
    render(
      <TooltipProvider>
        <HomeLink onNavigate={() => navigated++} />
      </TooltipProvider>
    );
    const home = screen.getByRole('button', { name: 'Home' });
    expect(home.textContent).toBe('Home');
    expect(home.getAttribute('aria-current')).toBeNull();
    expect(screen.queryByText('Shinsa')).toBeNull();
    expect(await findTooltipText(home)).toBe('Home⇧⌘H');
    act(() => fireEvent.click(home));
    expect(location.pathname).toBe('/');
    expect(navigated).toBe(1);
    expect(screen.getByRole('button', { name: 'Home' }).getAttribute('aria-current')).toBe('page');
  });

  it('leads the Cards top bar in the Mac app', () => {
    fake = installDesktop();
    act(() => navigate('/'));
    render(
      <TooltipProvider>
        <CardsTopBar state={STATE} />
      </TooltipProvider>
    );
    const bar = screen.getByRole('banner');
    expect(bar.querySelector('button')?.textContent).toBe('Home');
    expect(bar.textContent).not.toContain('Shinsa');
  });

  it('takes the Mac app look and the route from its scope, as the site’s demos render it', () => {
    act(() => navigate('/'));
    render(
      <TooltipProvider>
        <DesktopChrome value>
          <RouteScope value={parseRoute('/tasks')}>
            <CardsTopBar state={STATE} />
          </RouteScope>
        </DesktopChrome>
      </TooltipProvider>
    );
    const bar = screen.getByRole('banner');
    expect(bar.querySelector('button')?.textContent).toBe('Home');
    expect(bar.textContent).not.toContain('Shinsa');
    expect(screen.getByRole('button', { name: 'Home' }).getAttribute('aria-current')).toBeNull();
    expect(screen.getByRole('button', { name: 'Tasks' }).getAttribute('aria-current')).toBe('page');
  });

  it('goes to Tasks and Settings from the Cards top bar, each marked while you are there', async () => {
    act(() => navigate('/'));
    render(
      <TooltipProvider>
        <CardsTopBar state={STATE} />
      </TooltipProvider>
    );
    const bar = screen.getByRole('banner');
    expect([...bar.querySelectorAll('button')].map((button) => button.textContent).slice(0, 3)).toEqual([
      'Shinsa',
      'Tasks',
      'Services',
    ]);
    const tasks = screen.getByRole('button', { name: 'Tasks' });
    expect(tasks.getAttribute('aria-current')).toBeNull();
    act(() => fireEvent.click(tasks));
    expect(location.pathname).toBe('/tasks');
    expect(screen.getByRole('button', { name: 'Tasks' }).getAttribute('aria-current')).toBe('page');
    const settings = screen.getByRole('button', { name: 'Settings' });
    expect(settings.textContent).toBe('');
    expect(await findTooltipText(settings)).toBe('Settings');
    const buttons: HTMLElement[] = [...bar.querySelectorAll('button')];
    const after = buttons.slice(buttons.indexOf(settings) + 1);
    expect(after.map((button) => button.getAttribute('aria-label') ?? button.textContent).at(-1)).toBe(
      'FocusAll work'
    );
    expect(after.length).toBeLessThanOrEqual(2);
    act(() => fireEvent.click(settings));
    expect(location.pathname).toBe('/settings');
    expect(screen.getByRole('button', { name: 'Settings' }).getAttribute('aria-current')).toBe('page');
  });
});
