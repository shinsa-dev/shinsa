import { describe, expect, it, mock } from 'bun:test';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { fireEvent, render, screen } from '@testing-library/react';
import { CommandRunnerProvider } from '@/components/text/code-fence.tsx';
import { Markdown } from '@/components/text/markdown.tsx';

const TEXT = 'Sign in first:\n\n```sh\ngh auth login\n```\n\n```ts\nconst a = 1;\n```';

describe('CodeFence', () => {
  it('offers Run in terminal on a shell block where a card lets you run one, and runs only when pressed', () => {
    const run = mock(() => undefined);
    render(
      <TooltipProvider>
        <CommandRunnerProvider run={run}>
          <Markdown text={TEXT} />
        </CommandRunnerProvider>
      </TooltipProvider>
    );
    const buttons = screen.getAllByRole('button', { name: 'Run in terminal' });
    expect(buttons).toHaveLength(1);
    expect(run).not.toHaveBeenCalled();
    fireEvent.click(buttons[0] as HTMLElement);
    expect(run).toHaveBeenCalledWith('gh auth login');
  });

  it('has no Run in terminal anywhere else', () => {
    render(
      <TooltipProvider>
        <Markdown text={TEXT} />
      </TooltipProvider>
    );
    expect(screen.queryByRole('button', { name: 'Run in terminal' })).toBeNull();
  });
});
