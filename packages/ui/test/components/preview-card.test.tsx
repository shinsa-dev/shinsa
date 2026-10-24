import { afterEach, beforeEach, describe, expect, it, jest } from 'bun:test';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PreviewCard, PreviewCardContent, PreviewCardTrigger } from '../../src/components/preview-card';

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  cleanup();
  act(() => {
    jest.runOnlyPendingTimers();
  });
  jest.useRealTimers();
});

function Card({ name }: { name: string }) {
  return (
    <PreviewCard>
      <PreviewCardTrigger href='#'>{name}</PreviewCardTrigger>
      <PreviewCardContent>{`${name} details`}</PreviewCardContent>
    </PreviewCard>
  );
}

function advance(ms: number) {
  act(() => {
    jest.advanceTimersByTime(ms);
  });
}

function hover(name: string) {
  act(() => {
    const trigger = screen.getByText(name);
    fireEvent.pointerEnter(trigger, { pointerType: 'mouse' });
    fireEvent.mouseEnter(trigger);
    fireEvent.mouseMove(trigger);
  });
  advance(150);
}

describe('PreviewCard', () => {
  it('opens on hover with its enter animation', () => {
    render(<Card name='First' />);
    hover('First');
    const popup = screen.getByText('First details');
    expect(popup.dataset.slot).toBe('preview-card-content');
    expect(popup.hasAttribute('data-instant')).toBe(false);
  });

  it('lets the group cool down when an open card unmounts, so the next card animates again', () => {
    const first = render(<Card name='Alpha' />);
    hover('Alpha');
    expect(screen.getByText('Alpha details')).toBeTruthy();
    first.unmount();
    advance(350);

    render(<Card name='Beta' />);
    hover('Beta');
    expect(screen.getByText('Beta details').hasAttribute('data-instant')).toBe(false);
  });
});
