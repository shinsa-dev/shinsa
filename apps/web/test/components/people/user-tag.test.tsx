import { describe, expect, it } from 'bun:test';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { UserTag } from '@/components/people/user-tag.tsx';

async function openCard(name: HTMLElement) {
  const trigger = name.closest('a') ?? name;
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
        <UserTag user={{ login: 'kai', name: 'Kai Tanaka', avatarUrl: 'https://avatars.example/kai' }} />
      </div>
    );
    const trigger = screen.getByText('Kai');
    expect(trigger.closest('a')?.getAttribute('href')).toBe('https://github.com/kai');
    const card = await openCard(trigger);
    expect(card.textContent).toContain('Kai Tanaka');
    expect(card.textContent).toContain('Kai Tanakakai');
    expect(card.querySelector('img')?.getAttribute('src')).toBe('https://avatars.example/kai');
    expect(trigger.closest('a')?.querySelector('img')?.getAttribute('src')).toBe(
      'https://avatars.example/kai'
    );
    const profile = screen.getByText('View on GitHub').closest('a');
    expect(profile?.getAttribute('href')).toBe('https://github.com/kai');
    fireEvent.click(trigger);
    if (profile) fireEvent.click(profile);
    expect(onRow.clicks).toBe(0);
  });

  it('falls back to the login with an initial when GitHub has no name or photo', async () => {
    render(<UserTag user={{ login: 'mona', name: null, avatarUrl: null }} />);
    const name = screen.getByText('mona');
    expect(name.closest('a')?.querySelector('[aria-hidden]')?.textContent).toBe('M');
    expect(name.closest('a')?.querySelector('img')).toBeNull();
    const card = await openCard(name);
    expect(card.textContent).not.toContain('@');
    expect(card.textContent).toContain('M');
    expect(card.querySelector('img')).toBeNull();
  });
});
