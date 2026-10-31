import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AnswerBox } from '@/components/overview/answer-box.tsx';

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

const SHOT_BLOCK =
  '<attachments>\n<attachment kind="image" display_name="shot.png" mime_type="image/png" size_bytes="4" path="/d/shot.png" url="/api/attachments/1/shot.png" />\n</attachments>';

function renderBox(onSubmit: (text: string) => Promise<boolean>, busy = false) {
  render(
    <TooltipProvider>
      <AnswerBox
        label='Your answer'
        placeholder='Your answer goes straight to the agent.'
        submitLabel='Send answer'
        busy={busy}
        onSubmit={onSubmit}
      />
    </TooltipProvider>
  );
  return screen.getByRole('textbox', { name: 'Your answer' });
}

function sendButton() {
  return screen.getByRole('button', { name: 'Send answer' }) as HTMLButtonElement;
}

function pasteShot(field: HTMLElement) {
  fireEvent.paste(field, {
    clipboardData: { files: [new File(['data'], 'shot.png', { type: 'image/png' })] },
  });
}

describe('AnswerBox', () => {
  it('fades the text where it scrolls under the attachments and the footer', () => {
    const field = renderBox(mock(async (_text: string) => true));
    expect(field.classList.contains('scroll-fade')).toBe(true);
  });

  it('sends a typed answer and clears it once sent', async () => {
    const onSubmit = mock(async (_text: string) => true);
    const field = renderBox(onSubmit) as HTMLTextAreaElement;
    expect(sendButton().disabled).toBe(true);
    fireEvent.change(field, { target: { value: '  Only the failed chunk  ' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0]?.[0]).toBe('Only the failed chunk');
    await waitFor(() => expect(field.value).toBe(''));
  });

  it('sends a pasted image on its own, then clears it', async () => {
    const onSubmit = mock(async (_text: string) => true);
    const field = renderBox(onSubmit);
    pasteShot(field);
    expect(screen.getByRole('list', { name: 'Attachments' })).toBeDefined();
    await waitFor(() => expect(sendButton().disabled).toBe(false));
    fireEvent.click(sendButton());
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0]?.[0]).toBe(SHOT_BLOCK);
    await waitFor(() => expect(screen.queryByRole('list', { name: 'Attachments' })).toBeNull());
  });

  it('keeps the text and the files when the answer is not sent', async () => {
    const onSubmit = mock(async (_text: string) => false);
    const field = renderBox(onSubmit) as HTMLTextAreaElement;
    fireEvent.change(field, { target: { value: 'Whole export' } });
    pasteShot(field);
    await waitFor(() => expect(sendButton().disabled).toBe(false));
    fireEvent.click(sendButton());
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0]?.[0]).toBe(`Whole export\n\n${SHOT_BLOCK}`);
    expect(field.value).toBe('Whole export');
    expect(screen.getByRole('list', { name: 'Attachments' })).toBeDefined();
  });

  it('takes files from the paperclip and a drop', async () => {
    const field = renderBox(async () => true);
    const picker = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(picker, { target: { files: [new File(['a'], 'notes.txt', { type: 'text/plain' })] } });
    const box = field.parentElement as HTMLElement;
    const dataTransfer = {
      types: ['Files'],
      files: [new File(['b'], 'log.txt', { type: 'text/plain' })],
    };
    fireEvent.dragOver(box, { dataTransfer });
    fireEvent.drop(box, { dataTransfer });
    await waitFor(() => expect(screen.getAllByRole('button', { name: /^Remove / })).toHaveLength(2));
  });

  it('does not send while busy', () => {
    const onSubmit = mock(async (_text: string) => true);
    const field = renderBox(onSubmit, true);
    fireEvent.change(field, { target: { value: 'Whole export' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
