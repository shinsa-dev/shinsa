import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { fireEvent, render, screen } from '@testing-library/react';
import { TaskCommandRunner } from '@/components/task/command-runner.tsx';
import { Markdown } from '@/components/text/markdown.tsx';
import { spyOnCommands } from '../../support/commands.ts';
import { findTooltipText } from '../../support/hover.ts';
import { createTask } from '../../support/state.ts';
import { createTerminalState } from '../../support/terminals.ts';

let commands: ReturnType<typeof spyOnCommands>;

beforeEach(() => {
  commands = spyOnCommands();
});

afterEach(() => {
  commands.restore();
});

function renderProse(task = createTerminalState().tasks.fix) {
  return render(
    <TooltipProvider>
      <TaskCommandRunner state={createTerminalState()} task={task as never}>
        <Markdown text={'```bash run\nbun run dev\n```'} />
      </TaskCommandRunner>
    </TooltipProvider>
  );
}

describe('TaskCommandRunner', () => {
  it('runs a shell block of the task’s prose marked run in a terminal in its folder', async () => {
    renderProse();
    const button = screen.getByRole('button', { name: 'Run in terminal' });
    expect(await findTooltipText(button)).toBe('Run in terminal~/.config/shinsa/data/worktrees/fix');
    fireEvent.click(button);
    expect(commands.terminal).toHaveBeenCalledWith(expect.objectContaining({ id: 'fix' }), 'bun run dev');
  });

  it('offers no Run in terminal for a task with nowhere to open one', () => {
    renderProse(createTask({ id: 'loose' }));
    expect(screen.queryByRole('button', { name: 'Run in terminal' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Copy' })).toBeDefined();
  });
});
