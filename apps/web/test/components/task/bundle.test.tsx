import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { BundleFact, BundleMark } from '@/components/task/bundle.tsx';
import { findTooltipText } from '../../support/hover.ts';
import { createPullRequest } from '../../support/pull-request.ts';
import { startFakeServer, stopFakeServer } from '../../support/server.ts';
import { createRepo, createShinsaState, createTask } from '../../support/state.ts';

beforeEach(() => {
  startFakeServer();
});

afterEach(() => {
  stopFakeServer();
});

const root = createTask({
  id: 'root',
  handle: 'SW-1',
  title: 'Add the schema',
  repoId: 'app',
  stage: 'shipping',
  bundleReady: { commit: 'a' },
  pullRequest: createPullRequest({ number: 41 }),
});
const top = createTask({
  id: 'top',
  handle: 'SW-2',
  title: 'Add the screen',
  repoId: 'app',
  stacksOn: ['root'],
});
const state = createShinsaState({ tasks: [root, top], repos: [createRepo({ id: 'app' })] });

describe('the Bundle item in the task toolbar', () => {
  it('counts the ready tasks and lists every task as a tree from the root, with its state and pull request', async () => {
    render(
      <TooltipProvider>
        <BundleFact state={state} task={top} />
      </TooltipProvider>
    );
    const trigger = screen.getByRole('button', { name: 'Bundle 1/2' });
    await act(async () => {
      fireEvent.pointerEnter(trigger);
      fireEvent.mouseEnter(trigger);
      fireEvent.pointerMove(trigger);
      fireEvent.mouseMove(trigger);
    });
    expect(await screen.findByText('Bundle · 1 of 2 ready')).toBeTruthy();
    const items = within(screen.getByRole('list', { name: 'Tasks in the bundle' })).getAllByRole('listitem');
    expect(items.map((item) => item.textContent)).toEqual([
      'SW-1Add the schemaReady41',
      'SW-2Add the screenThis taskWorking',
    ]);
    const leading = (item: Element | undefined) =>
      Array.from(item?.querySelector('a')?.parentElement?.children ?? []).map((child) =>
        child.tagName === 'A' ? 'link' : (child.getAttribute('data-slot') ?? child.textContent)
      );
    expect(leading(items[0])).toEqual(['icon', 'SW-1', 'link']);
    expect(leading(items[1])).toEqual(['icon', 'icon', 'SW-2', 'link', 'This task']);
    expect(
      within(items[0] as HTMLElement)
        .getByRole('link', { name: 'Add the schema' })
        .getAttribute('href')
    ).toBe('/tasks/SW-1');
    expect(screen.getByText(/merges them all, from the bottom up/)).toBeTruthy();
  });

  it('names every task a task builds on when it builds on several', async () => {
    const side = createTask({
      id: 'side',
      handle: 'SW-3',
      title: 'Add the cache',
      repoId: 'app',
      stage: 'building',
    });
    const join = createTask({ id: 'join', title: 'Join them', repoId: 'app', stacksOn: ['root', 'side'] });
    render(
      <TooltipProvider>
        <BundleFact state={createShinsaState({ tasks: [root, side, join] })} task={join} />
      </TooltipProvider>
    );
    const trigger = screen.getByRole('button', { name: 'Bundle 1/3' });
    await act(async () => {
      fireEvent.pointerEnter(trigger);
      fireEvent.mouseEnter(trigger);
      fireEvent.pointerMove(trigger);
      fireEvent.mouseMove(trigger);
    });
    const list = await screen.findByRole('list', { name: 'Tasks in the bundle' });
    const parents = within(list).getByText('Builds on SW-1 and SW-3');
    expect(await findTooltipText(parents)).toBe('Builds on “Add the schema” and “Add the cache”');
  });

  it('shows nothing for a task outside any bundle', () => {
    const lone = createTask({ id: 'lone' });
    const { container } = render(<BundleFact state={createShinsaState({ tasks: [lone] })} task={lone} />);
    expect(container.textContent).toBe('');
  });
});

describe('the bundle mark on a queue row', () => {
  it('shows the count beside the bundle icon and names it on hover', async () => {
    render(
      <TooltipProvider>
        <BundleMark state={state} task={root} />
      </TooltipProvider>
    );
    const mark = screen.getByText('1/2');
    expect(await findTooltipText(mark)).toBe('Bundle · 1 of 2 ready');
  });

  it('shows nothing for a task outside any bundle', () => {
    const lone = createTask({ id: 'lone' });
    const { container } = render(<BundleMark state={createShinsaState({ tasks: [lone] })} task={lone} />);
    expect(container.textContent).toBe('');
  });
});
