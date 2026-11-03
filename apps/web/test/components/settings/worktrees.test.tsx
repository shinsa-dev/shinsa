import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { type OnboardingStatus, resolveEngineInfo } from '@shinsa/core';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { WorktreeSettings } from '@/components/settings/worktrees.tsx';
import { refreshOnboardingStatus } from '@/lib/connection/onboarding.ts';
import { spyOnToasts } from '../../support/commands.ts';
import { spyOnEngine } from '../../support/engine.ts';
import {
  createOnboardingStatus,
  createWorktreesStatus,
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

type FakeAnswer = Parameters<typeof startFakeOnboarding>[0][string];

const MOUNT = '/Volumes/r2/worktrees';

const CHOSEN = createWorktreesStatus({ effective: MOUNT, configured: MOUNT });

const MISSING_MESSAGE =
  'The worktree folder /no/such/mount does not exist. If it is on a drive you mount, mount it again, or choose another folder in Settings → Projects.';

function saveWorktrees(body: unknown) {
  const { path } = body as { path: string | null };
  if (path === null) return createOnboardingStatus();
  return createWorktreesStatus({ effective: path, configured: path });
}

const REFUSED = { status: 400, answer: { error: { code: 'worktrees_invalid', message: MISSING_MESSAGE } } };

async function renderWorktrees(
  status: OnboardingStatus,
  { supported = true, saved = { answer: saveWorktrees } }: { supported?: boolean; saved?: FakeAnswer } = {}
) {
  const engine = resolveEngineInfo('1.0.0');
  spyOnEngine(
    supported
      ? engine
      : { ...engine, features: engine.features.filter((feature) => feature !== 'worktree-root') }
  );
  fake = startFakeOnboarding({
    'GET /api/onboarding': { answer: status },
    'POST /api/onboarding/worktrees': saved,
  });
  await act(() => refreshOnboardingStatus());
  return render(
    <TooltipProvider>
      <WorktreeSettings />
    </TooltipProvider>
  );
}

function sentWorktrees() {
  return (fake?.requests ?? [])
    .filter((request) => request.path === '/api/onboarding/worktrees')
    .map((request) => request.body);
}

async function chooseFolder(path: string) {
  fireEvent.change(screen.getByLabelText('Choose a folder by its path'), { target: { value: path } });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Use folder' }));
  });
}

describe('the Worktrees settings', () => {
  it('shows the default folder and saves a chosen one', async () => {
    await renderWorktrees(createOnboardingStatus());
    expect(screen.getByText('/h/data/worktrees')).toBeTruthy();
    expect(screen.getByText('Default')).toBeTruthy();
    await chooseFolder(`  ${MOUNT} `);
    expect(sentWorktrees()).toEqual([{ path: MOUNT }]);
    expect(toasts.success).toHaveBeenCalledWith(`New worktrees go to ${MOUNT}.`);
    expect(screen.getByText(MOUNT)).toBeTruthy();
    expect((screen.getByLabelText('Choose a folder by its path') as HTMLInputElement).value).toBe('');
  });

  it('shows why a folder is refused under the field, until you type again', async () => {
    await renderWorktrees(createOnboardingStatus(), { saved: REFUSED });
    await chooseFolder('/no/such/mount');
    expect(screen.getByRole('alert').textContent).toBe(MISSING_MESSAGE);
    expect(toasts.success).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Choose a folder by its path'), { target: { value: '/x' } });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('goes back to the default folder', async () => {
    await renderWorktrees(CHOSEN);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Use default' }));
    });
    expect(sentWorktrees()).toEqual([{ path: null }]);
    expect(toasts.success).toHaveBeenCalledWith('New worktrees go to the default folder.');
    expect(screen.getByText('Default')).toBeTruthy();
  });

  it('warns when the chosen folder is gone', async () => {
    await renderWorktrees(
      createWorktreesStatus({ effective: MOUNT, configured: MOUNT, problem: 'The drive is not mounted.' })
    );
    expect(screen.getByRole('alert').textContent).toBe('The drive is not mounted.');
  });

  it('shows a folder set by SHINSA_WORKTREES_DIR as fixed', async () => {
    await renderWorktrees(createWorktreesStatus({ effective: '/mnt/r2', fromEnvironment: '/mnt/r2' }));
    expect(screen.getByText('From SHINSA_WORKTREES_DIR')).toBeTruthy();
    expect(screen.queryByLabelText('Choose a folder by its path')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Use default' })).toBeNull();
  });

  it('shows nothing on an engine that cannot change the folder', async () => {
    const { container } = await renderWorktrees(createOnboardingStatus(), { supported: false });
    expect(container.textContent).toBe('');
  });
});
