import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { act, cleanup, render, screen } from '@testing-library/react';
import { resetOnboardingStatus } from '@/lib/connection/onboarding.ts';
import { ERROR_COPY } from '@/lib/errors.ts';
import * as home from '@/lib/home.ts';
import * as services from '@/lib/terminal/services.ts';
import { Root } from '@/root.tsx';
import { navigate } from '@/router.ts';
import { createOnboardingStatus, startFakeOnboarding } from '../../support/onboarding.ts';
import { pushState, startFakeServer, stopFakeServer } from '../../support/server.ts';
import { createShinsaState } from '../../support/state.ts';

let fake: ReturnType<typeof startFakeOnboarding> | null = null;
let logged: ReturnType<typeof spyOn<Console, 'error'>>;

beforeEach(() => {
  logged = spyOn(console, 'error').mockImplementation(() => {});
  fake = startFakeOnboarding({
    'GET /api/health': { answer: { ok: true, seq: 1, problems: [] } },
    'GET /api/onboarding': { answer: createOnboardingStatus() },
  });
  startFakeServer();
  act(() => navigate('/'));
});

afterEach(() => {
  cleanup();
  act(() => resetOnboardingStatus());
  stopFakeServer();
  fake?.stop();
  fake = null;
  logged.mockRestore();
});

function composer() {
  return screen.queryByRole('textbox', { name: 'Describe the work' });
}

function servicesTrigger() {
  return document.querySelector('[data-services-trigger]');
}

describe('a render error in the app', () => {
  it('in a top bar menu shows a small warning in its place and leaves the page and the rest of the bar', () => {
    const broken = spyOn(services, 'describeServicesTrigger').mockImplementation(() => {
      throw new TypeError('Cannot read properties of undefined (reading ‘filter’)');
    });
    render(<Root />);
    pushState(createShinsaState({}));
    expect(screen.getByRole('alert', { name: ERROR_COPY.part })).toBeTruthy();
    expect(servicesTrigger()).toBeNull();
    expect(composer()).not.toBeNull();
    broken.mockRestore();
  });

  it('in a page shows the page fallback under a working top bar, and going to the page again recovers', () => {
    const greet = home.resolveGreeting;
    let failing = true;
    const broken = spyOn(home, 'resolveGreeting').mockImplementation((...args) => {
      if (failing) throw new Error('No greeting');
      return greet(...args);
    });
    render(<Root />);
    pushState(createShinsaState({}));
    expect(screen.getByText(ERROR_COPY.page)).toBeTruthy();
    expect(screen.getByText('No greeting')).toBeTruthy();
    expect(servicesTrigger()).not.toBeNull();
    act(() => navigate('/tasks'));
    failing = false;
    act(() => navigate('/'));
    expect(composer()).not.toBeNull();
    expect(screen.queryByText(ERROR_COPY.page)).toBeNull();
    broken.mockRestore();
  });
});
