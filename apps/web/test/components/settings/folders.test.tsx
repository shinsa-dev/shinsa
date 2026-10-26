import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { OnboardingStatus } from '@shinsa/core';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { FolderSettings, SetupSettings } from '@/components/settings/folders.tsx';
import { refreshOnboardingStatus } from '@/lib/connection/onboarding.ts';
import { spyOnToasts } from '../../support/commands.ts';
import {
  createFlow,
  createOnboardingStatus,
  createStep,
  createSuggestions,
  startFakeOnboarding,
} from '../../support/onboarding.ts';

let fake: ReturnType<typeof startFakeOnboarding> | null = null;

let toasts: ReturnType<typeof spyOnToasts>;

beforeEach(() => {
  toasts = spyOnToasts();
});

afterEach(() => {
  fake?.stop();
  fake = null;
  toasts.restore();
});

const CHOSEN = createOnboardingStatus({
  configured: ['/Users/me/Developer'],
  fromEnvironment: ['/srv/code'],
});

async function renderFolders(status: OnboardingStatus, saved: (body: unknown) => unknown = () => status) {
  fake = startFakeOnboarding({
    'GET /api/onboarding': { answer: status },
    'POST /api/onboarding/setup': { answer: saved },
    'GET /api/onboarding/roots?refresh=1': {
      answer: createSuggestions([
        ['/Users/me/Developer', 12],
        ['/Users/me/oss', 1],
      ]),
    },
    'POST /api/onboarding/flow': { answer: createFlow(createStep()) },
  });
  await act(() => refreshOnboardingStatus());
  return render(
    <TooltipProvider>
      <FolderSettings />
      <SetupSettings />
    </TooltipProvider>
  );
}

function sentSetups() {
  return (fake?.requests ?? [])
    .filter((request) => request.path === '/api/onboarding/setup')
    .map((request) => request.body);
}

describe('the Folders settings', () => {
  it('lists the chosen folders, and the SHINSA_ROOTS ones as fixed', async () => {
    await renderFolders(CHOSEN);
    expect(screen.getByText('~/Developer')).toBeTruthy();
    expect(screen.getByText('/srv/code')).toBeTruthy();
    expect(screen.getByText('From SHINSA_ROOTS')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Remove folder' })).toHaveLength(1);
  });

  it('says when no folder is chosen yet', async () => {
    await renderFolders(createOnboardingStatus());
    expect(screen.getByText('No folders chosen yet. Find folders or add one by its path.')).toBeTruthy();
  });

  it('removes a folder and adds one by its path', async () => {
    await renderFolders(CHOSEN);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Remove folder' }));
    });
    const field = screen.getByRole('textbox', { name: 'Add a folder by its path' });
    fireEvent.change(field, { target: { value: ' ~/work ' } });
    await act(async () => {
      fireEvent.submit(field.closest('form') as HTMLFormElement);
    });
    await waitFor(() =>
      expect(sentSetups()).toEqual([{ roots: [] }, { roots: ['/Users/me/Developer', '~/work'] }])
    );
    expect((field as HTMLInputElement).value).toBe('');
    expect(toasts.success).toHaveBeenCalledWith('Folder added.');
  });

  it('keeps the typed path and shows why the server refused it', async () => {
    await renderFolders(CHOSEN, () => ({ error: { message: '~/nope is not a folder on this machine.' } }));
    fake?.stop();
    fake = startFakeOnboarding({
      'POST /api/onboarding/setup': {
        status: 400,
        answer: { error: { message: '~/nope is not a folder on this machine.' } },
      },
    });
    const field = screen.getByRole('textbox', { name: 'Add a folder by its path' });
    fireEvent.change(field, { target: { value: '~/nope' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Add folder' }));
    });
    expect(toasts.error).toHaveBeenCalledWith('~/nope is not a folder on this machine.');
    expect((field as HTMLInputElement).value).toBe('~/nope');
  });

  it('finds folders that hold repositories and adds the one you pick', async () => {
    await renderFolders(CHOSEN);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Find folders' }));
    });
    const found = await screen.findByRole('menuitem', { name: /~\/oss/ });
    expect(screen.getByRole('menuitem', { name: /~\/Developer/ }).textContent).toContain('12 repositories');
    await act(async () => {
      fireEvent.click(found);
    });
    await waitFor(() => expect(sentSetups()).toEqual([{ roots: ['/Users/me/Developer', '/Users/me/oss'] }]));
  });

  it('says so when looking for folders fails', async () => {
    await renderFolders(CHOSEN);
    fake?.stop();
    fake = startFakeOnboarding({
      'GET /api/onboarding/roots?refresh=1': {
        status: 500,
        answer: { error: { message: 'Search failed.' } },
      },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Find folders' }));
    });
    expect(await screen.findByText('Search failed.')).toBeTruthy();
  });

  it('runs setup again from the start', async () => {
    await renderFolders(CHOSEN);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Run setup again' }));
    });
    await waitFor(() => expect(location.pathname).toBe('/onboarding'));
    expect(fake?.requests.find((request) => request.path === '/api/onboarding/flow')?.body).toEqual({
      type: 'restart',
    });
  });
});
