import { describe, expect, it } from 'bun:test';
import { act, fireEvent, render } from '@testing-library/react';
import { HoverHighlight } from '../../src/components/highlight-list';

function List() {
  return (
    <HoverHighlight>
      <button type='button' data-highlight-item data-active='true'>
        Home
      </button>
      <button type='button' data-highlight-item>
        Settings
      </button>
    </HoverHighlight>
  );
}

describe('HoverHighlight', () => {
  it('rests on the current item and follows the pointer', () => {
    const view = render(<List />);
    const home = view.getByRole('button', { name: 'Home' });
    const settings = view.getByRole('button', { name: 'Settings' });
    expect(home.hasAttribute('data-hovered')).toBe(true);

    fireEvent.pointerOver(settings);
    expect(settings.hasAttribute('data-hovered')).toBe(true);
    expect(home.hasAttribute('data-hovered')).toBe(false);
  });

  it('leaves the highlight where it is when the keyboard moves focus, since focus draws no state', () => {
    const view = render(<List />);
    const home = view.getByRole('button', { name: 'Home' });
    const settings = view.getByRole('button', { name: 'Settings' });

    act(() => {
      fireEvent.keyDown(document.body, { key: 'Tab' });
      settings.focus();
    });
    expect(home.hasAttribute('data-hovered')).toBe(true);
    expect(settings.hasAttribute('data-hovered')).toBe(false);
  });
});
