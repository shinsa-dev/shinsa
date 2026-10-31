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
      <Composer
        draftKey='task-1'
        placeholder='Tell the agent something'
        submitLabel='Send'
        onSubmit={onSubmit}
      />
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

describe('Composer drafts', () => {
  function renderPair(onSubmit: (text: string) => Promise<boolean>) {
    render(
      <TooltipProvider>
        <Composer draftKey='task-1' placeholder='On overview' submitLabel='Send' onSubmit={onSubmit} />
        <Composer draftKey='task-1' placeholder='On chat' submitLabel='Send from chat' onSubmit={onSubmit} />
        <Composer draftKey='task-2' placeholder='Another task' submitLabel='Send there' onSubmit={onSubmit} />
      </TooltipProvider>
    );
    return {
      overview: screen.getByRole('textbox', { name: 'On overview' }) as HTMLTextAreaElement,
      chat: screen.getByRole('textbox', { name: 'On chat' }) as HTMLTextAreaElement,
      other: screen.getByRole('textbox', { name: 'Another task' }) as HTMLTextAreaElement,
    };
  }

  it('shares the text and the files of one task, and sending clears them in every input', async () => {
    const onSubmit = mock(async (_text: string) => true);
    const { overview, chat, other } = renderPair(onSubmit);
    fireEvent.change(overview, { target: { value: 'Look at this' } });
    expect(chat.value).toBe('Look at this');
    expect(other.value).toBe('');
    fireEvent.paste(chat, {
      clipboardData: { files: [new File(['data'], 'shot.png', { type: 'image/png' })] },
    });
    expect(screen.getAllByRole('list', { name: 'Attachments' })).toHaveLength(2);
    await waitFor(() => expect(sendButton().disabled).toBe(false));
    fireEvent.click(sendButton());
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0]?.[0]).toStartWith('Look at this\n\n<attachments>');
    await waitFor(() => expect(chat.value).toBe(''));
    expect(overview.value).toBe('');
    expect(screen.queryByRole('list', { name: 'Attachments' })).toBeNull();
  });

  it('keeps a task’s draft when its input goes and comes back', () => {
    const onSubmit = mock(async (_text: string) => true);
    const first = render(
      <TooltipProvider>
        <Composer draftKey='task-1' placeholder='Before' submitLabel='Send' onSubmit={onSubmit} />
      </TooltipProvider>
    );
    fireEvent.change(screen.getByRole('textbox', { name: 'Before' }), {
      target: { value: 'Half a thought' },
    });
    first.unmount();
    renderComposer(onSubmit);
    expect(
      (screen.getByRole('textbox', { name: 'Tell the agent something' }) as HTMLTextAreaElement).value
    ).toBe('Half a thought');
  });

  function renderTabs(shown: 'overview' | 'review', onSubmit: (text: string) => Promise<boolean>) {
    return (
      <TooltipProvider>
        <div data-task-tabs>
          <div role='tablist'>
            <button type='button' role='tab'>
              Review
            </button>
          </div>
        </div>
        <div role='tablist'>
          <button type='button' role='tab'>
            Fix
          </button>
        </div>
        <button type='button'>Elsewhere</button>
        <Composer key={shown} draftKey='task-1' placeholder={shown} submitLabel='Send' onSubmit={onSubmit} />
      </TooltipProvider>
    );
  }

  it('takes the focus and the caret along when a tab click moves the input', () => {
    const onSubmit = mock(async (_text: string) => true);
    const view = render(renderTabs('overview', onSubmit));
    const overview = screen.getByRole('textbox', { name: 'overview' }) as HTMLTextAreaElement;
    fireEvent.change(overview, { target: { value: 'Keep typing' } });
    overview.focus();
    overview.setSelectionRange(4, 4);
    const tab = screen.getByRole('tab', { name: 'Review' });
    fireEvent.blur(overview, { relatedTarget: tab });
    view.rerender(renderTabs('review', onSubmit));
    const review = screen.getByRole('textbox', { name: 'review' }) as HTMLTextAreaElement;
    expect(document.activeElement).toBe(review);
    expect([review.value, review.selectionStart, review.selectionEnd]).toEqual(['Keep typing', 4, 4]);
  });

  it('leaves the focus alone when the input lost it to anything but a task tab', () => {
    const onSubmit = mock(async (_text: string) => true);
    const view = render(renderTabs('overview', onSubmit));
    const overview = screen.getByRole('textbox', { name: 'overview' });
    const elsewhere = screen.getByRole('button', { name: 'Elsewhere' });
    fireEvent.blur(overview, { relatedTarget: screen.getByRole('tab', { name: 'Fix' }) });
    fireEvent.blur(overview, { relatedTarget: elsewhere });
    fireEvent.blur(overview, { relatedTarget: null });
    elsewhere.focus();
    view.rerender(renderTabs('review', onSubmit));
    expect(document.activeElement).toBe(elsewhere);
  });
});
