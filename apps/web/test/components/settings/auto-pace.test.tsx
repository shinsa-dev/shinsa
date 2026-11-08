import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { createSettings, resolveEngineInfo, type Settings } from '@shinsa/core';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { AutoPaceSettings } from '@/components/settings/auto-pace.tsx';
import { spyOnToasts } from '../../support/commands.ts';
import { spyOnEngine } from '../../support/engine.ts';
import { listSentCommands, startFakeServer, stopFakeServer } from '../../support/server.ts';
import { createProject, createShinsaState } from '../../support/state.ts';

let toasts: ReturnType<typeof spyOnToasts>;

beforeEach(() => {
  toasts = spyOnToasts();
  startFakeServer();
  spyOnEngine();
});

afterEach(() => {
  toasts.restore();
  stopFakeServer();
});

async function settle() {
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
}

const PROJECTS = [createProject({ id: 'web', name: 'Web' }), createProject({ id: 'app', name: 'App' })];

function renderAutoPace(settings: Partial<Settings> = {}, paced = true) {
  const state = createShinsaState({
    projects: PROJECTS,
    patch: {
      settings: { ...createSettings(), ...settings },
      usagePaces: paced ? { claude: { provider: 'claude', pace: 140, at: Date.now() } } : {},
    },
  });
  return render(
    <TooltipProvider>
      <AutoPaceSettings state={state} />
    </TooltipProvider>
  );
}

describe('the Auto pace settings', () => {
  it('is off by default and turns on with one switch', async () => {
    renderAutoPace();
    const toggle = screen.getByRole('switch', { name: 'Auto pace' });
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(screen.queryByText('Project order')).toBeNull();
    fireEvent.click(toggle);
    await settle();
    expect(listSentCommands()).toEqual([{ type: 'settings.change', patch: { autoPace: true } }]);
  });

  it('shows the budget left, with no project order to keep', () => {
    renderAutoPace({ autoPace: true });
    expect(screen.getByText('Claude for the next 24 hours')).toBeTruthy();
    expect(screen.getByText('126% left')).toBeTruthy();
    expect(screen.queryByText('Project order')).toBeNull();
  });

  it('waits for the first usage reading before it shows a budget', () => {
    renderAutoPace({ autoPace: true }, false);
    expect(screen.getByText('Auto pace waits for the first usage reading of your accounts.')).toBeTruthy();
  });

  it('is hidden on an engine that cannot pace builds', () => {
    const engine = resolveEngineInfo('1.0.0');
    spyOnEngine({ ...engine, features: engine.features.filter((feature) => feature !== 'usage.auto_pace') });
    renderAutoPace();
    expect(screen.queryByRole('switch', { name: 'Auto pace' })).toBeNull();
  });
});
