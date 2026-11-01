import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { render, screen, within } from '@testing-library/react';
import { BundlePanel } from '@/components/overview/bundle-panel.tsx';
import { createPullRequest } from '../../support/pull-request.ts';
import { startFakeServer, stopFakeServer } from '../../support/server.ts';
import { createRepo, createShinsaState, createTask } from '../../support/state.ts';

beforeEach(() => {
  startFakeServer();
});

afterEach(() => {
  stopFakeServer();
});

describe('the Bundle panel on a task’s Overview', () => {
  it('lists every task of the bundle bottom first with its state and pull request', () => {
    const root = createTask({
      id: 'root',
      title: 'Add the schema',
      repoId: 'app',
      stage: 'shipping',
      bundleReady: { commit: 'a' },
      pullRequest: createPullRequest({ number: 41 }),
    });
    const top = createTask({ id: 'top', title: 'Add the screen', repoId: 'app', stacksOn: 'root' });
    const state = createShinsaState({ tasks: [root, top], repos: [createRepo({ id: 'app' })] });
    render(
      <TooltipProvider>
        <BundlePanel state={state} task={top} />
      </TooltipProvider>
    );
    expect(screen.getByText('1 of 2 ready')).toBeTruthy();
    const items = within(screen.getByRole('list', { name: 'Tasks in the bundle' })).getAllByRole('listitem');
    expect(items.map((item) => item.textContent)).toEqual([
      '1Add the schemaReady41',
      '2Add the screenThis taskWorking',
    ]);
    expect(screen.getByText(/merges the whole bundle into main, top down/)).toBeTruthy();
  });

  it('renders nothing for a task outside any bundle', () => {
    const lone = createTask({ id: 'lone' });
    const { container } = render(<BundlePanel state={createShinsaState({ tasks: [lone] })} task={lone} />);
    expect(container.textContent).toBe('');
  });
});
