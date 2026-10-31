import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Composer } from '@/components/task/composer.tsx';

const realFetch = globalThis.fetch;

let created: ReturnType<typeof spyOn>;

beforeEach(() => {
  globalThis.fetch = mock(async (_url: string, init: RequestInit) => {
    const { name } = JSON.parse(String(init.body)) as { name: string };
    return Response.json({
      kind: 'image',
      name,
      url: `/api/attachments/1/${name}`,
      path: `/d/${name}`,
      mimeType: 'image/png',
      size: 4,
    });
  }) as unknown as typeof globalThis.fetch;
  created = spyOn(URL, 'createObjectURL').mockReturnValue('blob:preview');
});

afterEach(() => {
  globalThis.fetch = realFetch;
  created.mockRestore();
});

function renderComposer(onSubmit: (text: string) => Promise<boolean>) {
  render(
    <TooltipProvider>
      <Composer placeholder='Tell the agent something' submitLabel='Send' onSubmit={onSubmit} />
    </TooltipProvider>
  );
  return screen.getByRole('textbox', { name: 'Tell the agent something' });
}

function sendButton() {
  return screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement;
}

describe('Composer attachments', () => {
  it('fades the text where it scrolls under the attachments and the footer', () => {
    const field = renderComposer(mock(async (_text: string) => true));
    expect(field.classList.contains('scroll-fade')).toBe(true);
  });

  it('sends an image on its own, then clears it once the message is sent', async () => {
    const onSubmit = mock(async (_text: string) => true);
    const field = renderComposer(onSubmit);
    expect(sendButton().disabled).toBe(true);
    fireEvent.paste(field, {
      clipboardData: { files: [new File(['data'], 'shot.png', { type: 'image/png' })] },
    });
    await waitFor(() => expect(sendButton().disabled).toBe(false));
    fireEvent.click(sendButton());
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0]?.[0]).toBe(
      '<attachments>\n<attachment kind="image" display_name="shot.png" mime_type="image/png" size_bytes="4" path="/d/shot.png" url="/api/attachments/1/shot.png" />\n</attachments>'
    );
    await waitFor(() => expect(screen.queryByRole('list', { name: 'Attachments' })).toBeNull());
  });

  it('keeps the text and the files when the message is not sent', async () => {
    const onSubmit = mock(async (_text: string) => false);
    const field = renderComposer(onSubmit);
    fireEvent.change(field, { target: { value: 'Look at this' } });
    fireEvent.drop(field.parentElement as HTMLElement, {
      dataTransfer: { files: [new File(['data'], 'shot.png', { type: 'image/png' })], types: ['Files'] },
    });
    await waitFor(() => expect(sendButton().disabled).toBe(false));
    fireEvent.keyDown(field, { key: 'Enter' });
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0]?.[0]).toStartWith('Look at this\n\n<attachments>');
    expect((field as HTMLTextAreaElement).value).toBe('Look at this');
    expect(screen.getByRole('img', { name: 'shot.png' })).toBeTruthy();
  });
});
