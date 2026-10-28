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

  it('lights the border with no line while a message is delivered, and says plainly when it needs no reply or was not delivered', () => {
    const sending = render(<UserMessage persistId={ID} text='Ship it' status='delivering' />);
    expect(sending.container.querySelector('[data-phase="active"] .message-delivery-light')).not.toBeNull();
    expect(sending.container.querySelector('[data-message]')?.getAttribute('data-delivery')).toBe('active');
    expect(sending.container.querySelector('.sr-only')?.textContent).toBe('Sending');
    expect(sending.container.textContent).toBe('Ship itSending');
    sending.rerender(<UserMessage persistId={ID} text='Ship it' />);
    expect(sending.container.querySelector('[data-phase="settling"]')).not.toBeNull();
    expect(sending.container.querySelector('[data-message]')?.getAttribute('data-delivery')).toBe('settling');
    expect(sending.container.querySelector('.sr-only')).toBeNull();
    sending.unmount();
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
