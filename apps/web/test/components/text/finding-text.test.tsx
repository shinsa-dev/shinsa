import { describe, expect, it, spyOn } from 'bun:test';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { render } from '@testing-library/react';
import { FindingText } from '@/components/text/finding-text.tsx';
import { createTask } from '../../support/state.ts';

describe('a finding’s code', () => {
  it('opens for a finding that starts on Fix and stays folded for an optional one', () => {
    const pending = spyOn(globalThis, 'fetch').mockImplementation(
      (() => new Promise<Response>(() => undefined)) as unknown as typeof fetch
    );
    const task = createTask({ id: 'finding-task', repoId: 'r-1' });
    const view = render(
      <TooltipProvider>
        <FindingText
          finding={{
            severity: 'blocking',
            file: 'src/a.ts',
            line: 3,
            end: null,
            message: 'Off by one.',
            title: 'The loop skips the last item',
            fix: 'Use `<=`.',
          }}
          task={task}
        />
        <FindingText
          finding={{ severity: 'should_fix', file: 'src/c.ts', line: 2, end: null, message: 'Handle empty.' }}
          task={task}
        />
        <FindingText
          finding={{ severity: 'optional', file: 'src/b.ts', line: 7, end: null, message: 'Rename it.' }}
          task={task}
        />
      </TooltipProvider>
    );
    expect(
      view
        .getAllByRole('button', { name: 'Collapse code' })
        .map((button) => button.getAttribute('aria-expanded'))
    ).toEqual(['true', 'true']);
    expect(view.getByText('Should fix').className).toContain('text-amber-text');
    expect(view.getByText('Optional').className).toContain('text-fg-2');
    expect(view.getByRole('button', { name: 'Expand code' }).getAttribute('aria-expanded')).toBe('false');
    expect(view.getAllByText('Reading the lines')).toHaveLength(2);
    expect(view.queryByText('The loop skips the last item')).toBeNull();
    expect(view.getByText('Off by one.')).toBeDefined();
    expect(view.getByText('Proposed fix')).toBeDefined();
    view.unmount();
    pending.mockRestore();
  });
});
