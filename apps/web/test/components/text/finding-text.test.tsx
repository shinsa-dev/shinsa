import { describe, expect, it, spyOn } from 'bun:test';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { render } from '@testing-library/react';
import { FindingText } from '@/components/text/finding-text.tsx';
import { createTask } from '../../support/state.ts';

describe('a finding’s code', () => {
  it('opens for a blocking finding and stays folded for any other', () => {
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
          finding={{ severity: 'suggestion', file: 'src/b.ts', line: 7, end: null, message: 'Rename it.' }}
          task={task}
        />
      </TooltipProvider>
    );
    expect(view.getByRole('button', { name: 'Collapse code' }).getAttribute('aria-expanded')).toBe('true');
    expect(view.getByRole('button', { name: 'Expand code' }).getAttribute('aria-expanded')).toBe('false');
    expect(view.getAllByText('Reading the lines')).toHaveLength(1);
    expect(view.getByText('The loop skips the last item')).toBeDefined();
    expect(view.getByText('Suggested fix')).toBeDefined();
    view.unmount();
    pending.mockRestore();
  });
});
