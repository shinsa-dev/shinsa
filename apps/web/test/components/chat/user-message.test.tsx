import { describe, expect, it } from 'bun:test';
import { fireEvent, render } from '@testing-library/react';
import { UserMessage } from '@/components/chat/user-message.tsx';
import { createDisclosureId } from '@/lib/preferences/disclosure.ts';

const ID = createDisclosureId('task', 't1', 'chat', 'block', 'm1', 'message');

describe('UserMessage', () => {
  it('clamps a long message behind Show more', () => {
    const text = Array.from({ length: 20 }, (_, index) => `Line ${index}`).join('\n');
    const view = render(<UserMessage persistId={ID} text={text} />);
    const toggle = view.getByRole('button', { name: 'Show more' });
    fireEvent.click(toggle);
    expect(toggle.textContent).toBe('Show less');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
  });

  it('stays open after it is unmounted and mounted again', () => {
    const text = Array.from({ length: 20 }, (_, index) => `Line ${index}`).join('\n');
    const first = render(<UserMessage persistId={ID} text={text} />);
    fireEvent.click(first.getByRole('button', { name: 'Show more' }));
    first.unmount();
    const again = render(<UserMessage persistId={ID} text={text} />);
    expect(again.getByRole('button', { name: 'Show less' }).getAttribute('aria-expanded')).toBe('true');
  });

  it('shimmers Sending and Queued while a message waits, and says plainly when it needs no reply or was not delivered', () => {
    const sending = render(<UserMessage persistId={ID} text='Ship it' status='sending' />);
    expect(sending.container.querySelector('.sr-only')?.textContent).toBe('Sending');
    sending.unmount();
    const queued = render(<UserMessage persistId={ID} text='Ship it' status='queued' />);
    expect(queued.container.querySelector('.sr-only')?.textContent).toBe('Queued');
    queued.unmount();
    const noted = render(<UserMessage persistId={ID} text='Thanks' status='noted' />);
    expect(noted.container.textContent).toBe('ThanksNoted. It needs no reply.');
    noted.unmount();
    const refused = render(
      <UserMessage
        persistId={ID}
        text='More?'
        status='undelivered'
        reason='This task is finished. Start a new one.'
      />
    );
    expect(refused.container.textContent).toBe('More?Not delivered. This task is finished. Start a new one.');
    refused.unmount();
    const delivered = render(<UserMessage persistId={ID} text='Ship it' />);
    expect(delivered.container.textContent).toBe('Ship it');
  });

  it('renders nothing for an empty message', () => {
    const view = render(<UserMessage persistId={ID} text='   ' />);
    expect(view.container.textContent).toBe('');
  });
});
