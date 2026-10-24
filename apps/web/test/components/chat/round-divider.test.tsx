import { describe, expect, it } from 'bun:test';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { render } from '@testing-library/react';
import { RoundDivider } from '@/components/chat/round-divider.tsx';
import { createRound } from '../../support/rounds.ts';
import { listStretchedTriggers } from '../../support/triggers.ts';

function renderDivider(first: boolean) {
  return render(
    <TooltipProvider>
      <RoundDivider
        round={createRound({ number: 2, title: 'Restructure the projects directory' })}
        first={first}
      />
    </TooltipProvider>
  );
}

describe('RoundDivider', () => {
  it('is a hairline after the round, its title and its status in its tone', () => {
    const view = renderDivider(false);
    const divider = view.getByRole('heading', {
      level: 2,
      name: 'Round 2 · Restructure the projects directory · Merged',
    });
    expect(view.getByText('Round 2').className).toContain('text-fg-3');
    expect(view.getByText('Merged').className).toContain('text-purple-text');
    expect(divider.querySelector('[aria-hidden].bg-border')).toBeTruthy();
    expect(divider.className).toContain('mt-7');
    expect(divider.querySelector('[data-chat-line]')?.className).toContain('h-5');
    expect(listStretchedTriggers(divider)).toEqual([]);
  });

  it('adds no space above the chat’s first round', () => {
    expect(renderDivider(true).getByRole('heading', { level: 2 }).className).not.toContain('mt-7');
  });
});
