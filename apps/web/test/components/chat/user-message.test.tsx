import { describe, expect, it } from 'bun:test';
import { fireEvent, render } from '@testing-library/react';
import { UserMessage } from '@/components/chat/user-message.tsx';

describe('UserMessage', () => {
  it('clamps a long message behind Show more', () => {
    const text = Array.from({ length: 20 }, (_, index) => `Line ${index}`).join('\n');
    const view = render(<UserMessage text={text} />);
    const toggle = view.getByRole('button', { name: 'Show more' });
    fireEvent.click(toggle);
    expect(toggle.textContent).toBe('Show less');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
  });

  it('shimmers Sending and Queued while a message waits, and says plainly when it needs no reply or was not delivered', () => {
    const sending = render(<UserMessage text='Ship it' status='sending' />);
    expect(sending.container.querySelector('.sr-only')?.textContent).toBe('Sending');
    sending.unmount();
    const queued = render(<UserMessage text='Ship it' status='queued' />);
    expect(queued.container.querySelector('.sr-only')?.textContent).toBe('Queued');
    queued.unmount();
    const noted = render(<UserMessage text='Thanks' status='noted' />);
    expect(noted.container.textContent).toBe('ThanksNoted. It needs no reply.');
    noted.unmount();
    const refused = render(
      <UserMessage text='More?' status='undelivered' reason='This task is finished. Start a new one.' />
    );
    expect(refused.container.textContent).toBe('More?Not delivered. This task is finished. Start a new one.');
    refused.unmount();
    const delivered = render(<UserMessage text='Ship it' />);
    expect(delivered.container.textContent).toBe('Ship it');
  });

  it('renders nothing for an empty message', () => {
    const view = render(<UserMessage text='   ' />);
    expect(view.container.textContent).toBe('');
  });
});
