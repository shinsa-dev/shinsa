import { describe, expect, it } from 'bun:test';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { UserTag } from '@/components/people/user-tag.tsx';

async function openCard(trigger: HTMLElement) {
  await act(async () => {
    fireEvent.pointerEnter(trigger, { pointerType: 'mouse' });
    fireEvent.mouseEnter(trigger);
    fireEvent.pointerMove(trigger, { pointerType: 'mouse' });
    fireEvent.mouseMove(trigger);
  });
  return waitFor(() => {
    const card = document.querySelector('[data-slot="preview-card-content"]');
    if (!card?.textContent) throw new Error('No user card is open.');
    return card as HTMLElement;
  });
}

describe('the user tag', () => {
  it('shows a first name and opens a card with the full name, login and GitHub profile', async () => {
    const onRow = { clicks: 0 };
    render(
      // biome-ignore lint/a11y/noStaticElementInteractions: a stand-in for a clickable row
      // biome-ignore lint/a11y/useKeyWithClickEvents: a stand-in for a clickable row
      <div onClick={() => onRow.clicks++}>
        <UserTag
          user={{ login: 'kai', name: 'Kai Tanaka', avatarUrl: 'https://avatars.example/kai' }}
          detail='On Studio, read-only'
        />
      </div>
    );
    const trigger = screen.getByText('Kai');
    expect(trigger.closest('a')?.getAttribute('href')).toBe('https://github.com/kai');
    const card = await openCard(trigger);
    expect(card.textContent).toContain('Kai Tanaka');
    expect(card.textContent).toContain('@kai');
    expect(card.textContent).toContain('On Studio, read-only');
    expect(card.querySelector('img')?.getAttribute('src')).toBe('https://avatars.example/kai');
    const profile = screen.getByText('View on GitHub').closest('a');
    expect(profile?.getAttribute('href')).toBe('https://github.com/kai');
    fireEvent.click(trigger);
    if (profile) fireEvent.click(profile);
    expect(onRow.clicks).toBe(0);
  });

  it('falls back to the login with an initial when GitHub has no name or photo', async () => {
    render(<UserTag user={{ login: 'mona', name: null, avatarUrl: null }} />);
    const card = await openCard(screen.getByText('mona'));
    expect(card.textContent).toContain('@mona');
    expect(card.textContent).toContain('M');
    expect(card.querySelector('img')).toBeNull();
  });
});
