import { describe, expect, it } from 'bun:test';
import type { ChatEntry } from '@shinsa/core';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { fireEvent, render } from '@testing-library/react';
import { ToolGroup } from '@/components/chat/tool-group.tsx';
import { resolveTimeline, type ToolCall } from '@/lib/chat/timeline.ts';
import { createEntry } from '../../support/server.ts';

function runCommands(count: number, { failed = [] as number[], open = [] as number[] } = {}) {
  const entries: ChatEntry[] = [];
  for (let index = 0; index < count; index += 1) {
    entries.push(
      createEntry(
        {
          type: 'tool_call',
          callId: `c${index}`,
          tool: { kind: 'command', action: 'run', command: `step ${index}`, description: null },
        },
        `c${index}`,
        index * 10
      )
    );
    if (open.includes(index)) continue;
    entries.push(
      createEntry(
        {
          type: 'tool_result',
          callId: `c${index}`,
          status: failed.includes(index) ? 'error' : 'ok',
          output: 'done',
          images: [],
        },
        `r${index}`,
        index * 10 + 1
      )
    );
  }
  const [group] = resolveTimeline(entries, []);
  return group?.kind === 'tools' ? group.calls : ([] as ToolCall[]);
}

function renderGroup(calls: ToolCall[], live = false) {
  return render(
    <TooltipProvider>
      <ToolGroup calls={calls} live={live} />
    </TooltipProvider>
  );
}

describe('ToolGroup', () => {
  it('shows a single call as its own row', () => {
    const view = renderGroup(runCommands(1));
    expect(view.getByRole('button').textContent).toBe('Ranstep 0');
  });

  it('folds calls in a row into one counted row and says how many failed', () => {
    const view = renderGroup(runCommands(3, { failed: [1] }));
    const row = view.getByRole('button', { name: /Ran 3 commands/ });
    expect(row.textContent).toBe('Ran 3 commands1 failed');
    expect(view.queryByText('step 0')).toBeNull();
  });

  it('opens onto every call and offers Collapse when the list is long', () => {
    const view = renderGroup(runCommands(6));
    fireEvent.click(view.getByRole('button', { name: 'Ran 6 commands' }));
    expect(view.getByText('step 5')).toBeTruthy();
    fireEvent.click(view.getByRole('button', { name: 'Collapse' }));
    expect(view.queryByText('step 5')).toBeNull();
  });

  it('keeps the running call visible under the folded row while the run is live', () => {
    const view = renderGroup(runCommands(3, { open: [2] }), true);
    expect(view.getByRole('button', { name: /Ran 3 commands/ })).toBeTruthy();
    expect(view.container.textContent).toContain('Running step 2');
  });
});
