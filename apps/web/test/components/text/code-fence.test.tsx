import { describe, expect, it, mock } from 'bun:test';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CommandRunnerProvider } from '@/components/text/code-block.tsx';
import { Markdown } from '@/components/text/markdown.tsx';
import { findTooltipText } from '../../support/hover.ts';

const TEXT = [
  'Sign in first:',
  '```sh run\n$ gh auth login\n```',
  '```bash run title=start\nbun dev\n```',
  'For example:',
  '```bash\nbun test --watch\n```',
  '```ts\nconst a = 1;\n```',
  '```\n$ bun dev\n```',
].join('\n\n');

describe('CodeFence', () => {
  it('offers Run in terminal on each shell block marked run where a task can run one, naming the folder, and runs only when pressed', async () => {
    const run = mock(() => undefined);
    render(
      <TooltipProvider>
        <CommandRunnerProvider runner={{ run, folder: '/Users/ada/Developer/shop' }}>
          <Markdown text={TEXT} />
        </CommandRunnerProvider>
      </TooltipProvider>
    );
    const buttons = screen.getAllByRole('button', { name: 'Run in terminal' });
    expect(buttons).toHaveLength(2);
    expect(await findTooltipText(buttons[0] as HTMLElement)).toBe('Run in terminal~/Developer/shop');
    expect(run).not.toHaveBeenCalled();
    fireEvent.click(buttons[0] as HTMLElement);
    expect(run).toHaveBeenCalledWith('gh auth login');
    fireEvent.click(buttons[1] as HTMLElement);
    expect(run).toHaveBeenLastCalledWith('bun dev');
  });

  it('highlights a fence marked run as its language, and never shows the mark', async () => {
    const { container } = render(
      <TooltipProvider>
        <Markdown text={'```bash run\nbun dev --port 5173\n```\n\n```bash\nbun dev --port 5173\n```'} />
      </TooltipProvider>
    );
    await waitFor(() => expect(container.querySelectorAll('pre span[style]').length).toBeGreaterThan(0));
    const [runnable, example] = [...container.querySelectorAll('pre')];
    expect(runnable?.innerHTML).toBe(example?.innerHTML as string);
    expect(container.textContent).not.toContain('run');
  });

  it('sets a text diagram at the line height its box-drawing lines join at', () => {
    const { container } = render(
      <TooltipProvider>
        <Markdown text={'```text\na ──▶ b\n  │\n  ▼\n  c\n```\n\n```ts\nconst a = 1;\n```'} />
      </TooltipProvider>
    );
    expect([...container.querySelectorAll('pre')].map((pre) => pre.dataset.diagram ?? null)).toEqual([
      'true',
      null,
    ]);
  });

  it('has no Run in terminal where nothing can run it', () => {
    render(
      <TooltipProvider>
        <Markdown text={TEXT} />
      </TooltipProvider>
    );
    expect(screen.queryByRole('button', { name: 'Run in terminal' })).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Copy' })).toHaveLength(5);
  });
});
