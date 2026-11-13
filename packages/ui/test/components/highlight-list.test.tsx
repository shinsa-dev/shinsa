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

  it('keeps the last hovered item over a gap only when asked to', () => {
    const gapped = (hold: boolean) =>
      render(
        <HoverHighlight holdOverGaps={hold}>
          <button type='button' data-highlight-item data-active='true'>
            Home
          </button>
          <div data-testid='gap' />
          <button type='button' data-highlight-item>
            Settings
          </button>
        </HoverHighlight>
      );
    const held = gapped(true);
    fireEvent.pointerOver(held.getByRole('button', { name: 'Settings' }));
    fireEvent.pointerOver(held.getByTestId('gap'));
    expect(held.getByRole('button', { name: 'Settings' }).hasAttribute('data-hovered')).toBe(true);
    held.unmount();

    const plain = gapped(false);
    fireEvent.pointerOver(plain.getByRole('button', { name: 'Settings' }));
    fireEvent.pointerOver(plain.getByTestId('gap'));
    expect(plain.getByRole('button', { name: 'Home' }).hasAttribute('data-hovered')).toBe(true);
  });

  it('lets the highlight go back to rest over an element marked as a release, even while holding over gaps', () => {
    const view = render(
      <HoverHighlight holdOverGaps>
        <div data-highlight-release=''>
          <span data-testid='header'>In progress</span>
        </div>
        <button type='button' data-highlight-item data-active='true'>
          Home
        </button>
        <button type='button' data-highlight-item>
          Settings
        </button>
      </HoverHighlight>
    );
    fireEvent.pointerOver(view.getByRole('button', { name: 'Settings' }));
    fireEvent.pointerOver(view.getByTestId('header'));
    expect(view.getByRole('button', { name: 'Home' }).hasAttribute('data-hovered')).toBe(true);
    expect(view.getByRole('button', { name: 'Settings' }).hasAttribute('data-hovered')).toBe(false);
  });

  it('drops its pointer mark when it cleans up, so a page shown again rests on the current item', () => {
    const view = render(<List />);
    const settings = view.getByRole('button', { name: 'Settings' });
    fireEvent.pointerOver(settings);
    expect(settings.hasAttribute('data-hovered')).toBe(true);

    view.unmount();
    expect(settings.hasAttribute('data-hovered')).toBe(false);
  });
});
