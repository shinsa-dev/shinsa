import { afterEach, describe, expect, it, mock, spyOn } from 'bun:test';
import type { SharePreview } from '@shinsa/core';
import { render, screen } from '@testing-library/react';
import { SHARED_PREVIEW_NOTE } from '@/lib/share/page.ts';
import { SharePreviewPage } from '@/routes/share-preview.tsx';
import { createSharedTask } from '../lib/share/fixtures.ts';
import { createShinsaState, createTask } from '../support/state.ts';

afterEach(() => {
  mock.restore();
});

const STATE = createShinsaState({ tasks: [createTask({ id: 'task-1', handle: 'SW-34' })] });

describe('the share preview', () => {
  it('shows what a viewer would see, from the engine’s preview of the task', async () => {
    const preview: SharePreview = { shared: createSharedTask({ code: false }), files: {}, updatedAt: 1 };
    const fetch = spyOn(globalThis, 'fetch').mockResolvedValue(Response.json(preview));
    render(<SharePreviewPage state={STATE} reference='SW-34' />);
    expect(await screen.findByText(SHARED_PREVIEW_NOTE)).toBeTruthy();
    expect(fetch.mock.calls[0]?.[0]).toBe('/api/tasks/task-1/share/preview');
  });

  it('says when the preview did not load, and when there is no such task', async () => {
    spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({ error: { message: 'This task shares no code.' } }, { status: 400 })
    );
    const { unmount } = render(<SharePreviewPage state={STATE} reference='SW-34' />);
    expect(await screen.findByText('The preview did not load')).toBeTruthy();
    expect(screen.getByText('This task shares no code.')).toBeTruthy();
    unmount();
    render(<SharePreviewPage state={STATE} reference='SW-99' />);
    expect(screen.getByText('No such task')).toBeTruthy();
  });
});
