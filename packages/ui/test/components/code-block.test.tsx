import { afterEach, describe, expect, it, mock } from 'bun:test';
import { act, fireEvent, render } from '@testing-library/react';
import { CodeBlock } from '../../src/components/code-block';
import { flush } from '../support/layout';

const original = navigator.clipboard;

afterEach(() => {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: original });
});

function clipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
}

describe('CodeBlock', () => {
  it('copies the code and confirms only once the clipboard accepted it', async () => {
    const writeText = mock(() => Promise.resolve());
    const onCopy = mock();
    clipboard(writeText);
    const view = render(<CodeBlock code='bun install' onCopy={onCopy} />);

    fireEvent.click(view.getByRole('button', { name: 'Copy' }));
    expect(writeText).toHaveBeenCalledWith('bun install');
    await act(() => flush());
    expect(view.getByRole('button', { name: 'Copied' })).toBeTruthy();
    expect(onCopy).toHaveBeenCalledTimes(1);
  });

  it('does not claim a copy the browser refused', async () => {
    const onCopy = mock();
    clipboard(() => Promise.reject(new Error('denied')));
    const view = render(<CodeBlock code='secret' onCopy={onCopy} />);

    fireEvent.click(view.getByRole('button', { name: 'Copy' }));
    await act(() => flush());
    expect(view.getByRole('button', { name: 'Copy' })).toBeTruthy();
    expect(onCopy).not.toHaveBeenCalled();
  });
});
