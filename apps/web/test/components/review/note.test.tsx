import { describe, expect, it } from 'bun:test';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ReviewNote } from '@/components/review/note.tsx';
import { FindingText } from '@/components/text/finding-text.tsx';
import { createDisclosureId, flushDisclosures, resetDisclosures } from '@/lib/preferences/disclosure.ts';
import { type ReviewItem, toCommentItem, toFindingItem } from '@/lib/review/report.ts';

const noteId = (name: string) => createDisclosureId('task', 't1', 'review', 'card', name);

const FINDING = {
  severity: 'blocking' as const,
  file: 'src/a.ts',
  line: 3,
  end: null,
  title: 'The loop skips the last item',
  message: 'Off by one.',
  fix: 'Use `<=`.',
};

function readHeadRow(body: string) {
  return screen.getAllByText(body)[0]?.closest('.justify-between') as HTMLElement;
}

describe('a finding card', () => {
  it('shows only its level, the issue and the proposed fix, with the action beside them on every card', () => {
    render(
      <TooltipProvider>
        <div data-testid='review'>
          <ReviewNote
            persistId={noteId('1')}
            item={toFindingItem(FINDING, 0)}
            action={<button type='button'>Fix here</button>}
          />
        </div>
        <div data-testid='overview'>
          <FindingText
            finding={{ ...FINDING, message: 'The Overview card.' }}
            action={<button type='button'>Fix there</button>}
          />
        </div>
      </TooltipProvider>
    );
    for (const [body, action] of [
      ['Off by one.', 'Fix here'],
      ['The Overview card.', 'Fix there'],
    ] as const) {
      const row = readHeadRow(body);
      expect(row.className).toContain('justify-between');
      expect(row.contains(screen.getByRole('button', { name: action }))).toBe(true);
      expect(row.textContent).toContain('Blocking');
      expect(row.textContent).not.toContain('Agent review');
      expect(row.querySelector('.rounded-full')).toBeNull();
    }
    expect(screen.queryByText('The loop skips the last item')).toBeNull();
    expect(screen.getAllByText('Proposed fix')).toHaveLength(2);
    expect(screen.queryByRole('banner')).toBeNull();
    expect(screen.getByTestId('review').querySelector('header')).toBeNull();
  });
});

const CALL: ReviewItem = {
  ...toFindingItem(FINDING, 0),
  key: 'call:0',
  label: 'Judgement call',
  tone: 'purple',
  author: 'agent',
  title: 'Keep the old keys',
  lead: 'Kept the old spot keys',
  body: 'Links already shared still open.',
  fix: null,
  place: null,
  section: 'Read the spots',
  finding: null,
};

function readBar(text: string) {
  return screen.getByText(text).closest('.bg-bg-a1') as HTMLElement;
}

describe('a review point that is not a finding', () => {
  it('opens on a header bar with its title, tag, section and action, and folds from it', () => {
    const removed: string[] = [];
    render(
      <TooltipProvider>
        <ReviewNote
          persistId={noteId('2')}
          item={CALL}
          action={
            <button type='button' onClick={() => removed.push('call')}>
              Remove
            </button>
          }
        />
      </TooltipProvider>
    );
    const bar = readBar('Keep the old keys');
    expect(bar.textContent).toContain('Judgement call');
    expect(bar.textContent).toContain('Read the spots');
    expect(bar.textContent).not.toContain('Agent');
    expect(bar.contains(screen.getByRole('button', { name: 'Remove' }))).toBe(true);
    expect(bar.contains(screen.getByText('Kept the old spot keys'))).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(removed).toEqual(['call']);
    expect(screen.getByText('Links already shared still open.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Collapse judgement call' }));
    expect(screen.queryByText('Links already shared still open.')).toBeNull();
    fireEvent.click(bar);
    expect(screen.getByText('Kept the old spot keys')).toBeTruthy();
  });

  it('names you on your comment, and no author on the agent’s points or the agent review’s findings', () => {
    render(
      <TooltipProvider>
        <ReviewNote
          persistId={noteId('3')}
          item={{ ...CALL, key: 'risk:0', label: 'Risk', title: 'Uncapped wait', lead: null }}
        />
        <ReviewNote
          persistId={noteId('4')}
          item={toCommentItem({
            id: 'c1',
            path: 'src/a.ts',
            side: 'new',
            line: 3,
            endLine: null,
            ref: null,
            text: 'Why three?',
          })}
        />
        <ReviewNote persistId={noteId('5')} item={toFindingItem(FINDING, 0)} />
      </TooltipProvider>
    );
    expect(readBar('Uncapped wait').textContent).not.toContain('Agent');
    expect(readBar('You').textContent).toContain('Line 3');
    expect(readHeadRow('Off by one.').textContent).not.toContain('Agent review');
  });

  it('opens again when a jump selects it', () => {
    const view = render(<ReviewNote persistId={noteId('6')} item={{ ...CALL, section: null }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Collapse judgement call' }));
    expect(screen.queryByText('Links already shared still open.')).toBeNull();
    view.rerender(<ReviewNote persistId={noteId('6')} item={{ ...CALL, section: null }} selected />);
    expect(screen.getByText('Links already shared still open.')).toBeTruthy();
  });

  it('stays folded after a refresh or a trip away, and nothing else shares its fold', () => {
    const first = render(<ReviewNote persistId={noteId('call')} item={{ ...CALL, section: null }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Collapse judgement call' }));
    first.unmount();
    resetDisclosuresKeepingStorage();
    render(<ReviewNote persistId={noteId('call')} item={{ ...CALL, section: null }} />);
    expect(screen.queryByText('Links already shared still open.')).toBeNull();
    expect(screen.getByRole('button', { name: 'Expand judgement call' })).toBeTruthy();
    cleanup();
    render(<ReviewNote persistId={noteId('other')} item={{ ...CALL, section: null }} />);
    expect(screen.getByText('Links already shared still open.')).toBeTruthy();
  });
});

function resetDisclosuresKeepingStorage() {
  flushDisclosures();
  resetDisclosures();
}
