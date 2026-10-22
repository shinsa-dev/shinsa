import { describe, expect, it } from 'bun:test';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { PreviewCard, PreviewCardContent, PreviewCardTrigger } from '../../src/components/preview-card';
import { flush } from '../support/layout';

function Card({ name }: { name: string }) {
  return (
    <PreviewCard>
      <PreviewCardTrigger href='#'>{name}</PreviewCardTrigger>
      <PreviewCardContent>{`${name} details`}</PreviewCardContent>
    </PreviewCard>
  );
}

async function hover(name: string) {
  await act(async () => {
    const trigger = screen.getByText(name);
    fireEvent.pointerEnter(trigger, { pointerType: 'mouse' });
    fireEvent.mouseEnter(trigger);
    fireEvent.mouseMove(trigger);
    await flush(150);
  });
}

describe('PreviewCard', () => {
  it('opens on hover with its enter animation', async () => {
    const view = render(<Card name='First' />);
    await hover('First');
    const popup = screen.getByText('First details');
    expect(popup.dataset.slot).toBe('preview-card-content');
    expect(popup.hasAttribute('data-instant')).toBe(false);
    view.unmount();
    await act(() => flush(350));
  });

  it('lets the group cool down when an open card unmounts, so the next card animates again', async () => {
    const first = render(<Card name='Alpha' />);
    await hover('Alpha');
    expect(screen.getByText('Alpha details')).toBeTruthy();
    first.unmount();
    await act(() => flush(350));

    render(<Card name='Beta' />);
    await hover('Beta');
    expect(screen.getByText('Beta details').hasAttribute('data-instant')).toBe(false);
  });
});
