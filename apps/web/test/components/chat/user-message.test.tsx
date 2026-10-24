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

  it('shimmers Delivering under a message on its way to the server', () => {
    const view = render(<UserMessage text='Ship it' pending />);
    expect(view.container.querySelector('.sr-only')?.textContent).toBe('Delivering');
    view.unmount();
    const delivered = render(<UserMessage text='Ship it' />);
    expect(delivered.container.textContent).toBe('Ship it');
  });

  it('renders nothing for an empty message', () => {
    const view = render(<UserMessage text='   ' />);
    expect(view.container.textContent).toBe('');
  });
});
