import { describe, expect, it, mock } from 'bun:test';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { fireEvent, render, screen } from '@testing-library/react';
import { AttachmentChips } from '@/components/chat/attachment-chips.tsx';
import type { Attachments } from '@/hooks/use-attachments.ts';
import type { AttachmentDraft } from '@/lib/chat/attachment-drafts.ts';

function draft(overrides: Partial<AttachmentDraft>): AttachmentDraft {
  return {
    key: 'a',
    name: 'shot.png',
    kind: 'image',
    mimeType: 'image/png',
    size: 2048,
    preview: 'blob:http://localhost/a',
    stored: null,
    ...overrides,
  };
}

function renderChips(drafts: AttachmentDraft[]) {
  const attachments: Attachments = {
    drafts,
    ready: [],
    add: mock(() => undefined),
    addTransfer: mock(() => false),
    remove: mock(() => undefined),
    clear: mock(() => undefined),
  };
  render(
    <TooltipProvider>
      <AttachmentChips attachments={attachments} />
    </TooltipProvider>
  );
  return attachments;
}

describe('AttachmentChips', () => {
  it('opens an attached image in the viewer, counting only the images', async () => {
    renderChips([
      draft({ key: 'a', name: 'first.png', preview: 'blob:http://localhost/a' }),
      draft({ key: 'f', name: 'log.txt', kind: 'file', mimeType: 'text/plain', preview: null }),
      draft({ key: 'b', name: 'second.png', preview: 'blob:http://localhost/b' }),
    ]);
    expect(screen.queryByRole('button', { name: 'Open log.txt' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Open second.png' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('2 of 2');
    expect(dialog.querySelector('img[src="blob:http://localhost/b"]')).not.toBeNull();
  });

  it('still removes an image without opening it', () => {
    const attachments = renderChips([draft({ key: 'a', name: 'shot.png' })]);
    fireEvent.click(screen.getByRole('button', { name: 'Remove shot.png' }));
    expect(attachments.remove).toHaveBeenCalledWith('a');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows nothing without attachments', () => {
    renderChips([]);
    expect(screen.queryByRole('list', { name: 'Attachments' })).toBeNull();
  });
});
