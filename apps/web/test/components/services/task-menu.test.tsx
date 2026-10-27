import { describe, expect, it } from 'bun:test';
import { resolveServiceView } from '@shinsa/core';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ServiceHandlers } from '@/components/services/service-row.tsx';
import { TaskServicesPanel } from '@/components/services/task-menu.tsx';
import { createProject, NOW } from '../../support/state.ts';
import { createService } from '../../support/terminals.ts';

describe('TaskServicesPanel', () => {
  it('names the task and starts a service for it', () => {
    const calls: string[] = [];
    const record = (name: string) => () => calls.push(name);
    const handlers: ServiceHandlers = {
      start: (view) => calls.push(`start ${view.service.name} ${view.taskId}`),
      stop: record('stop'),
      restart: record('restart'),
      startAll: record('start all'),
      open: record('open'),
    };
    render(
      <TooltipProvider>
        <TaskServicesPanel
          task={{ handle: 'SH-4' }}
          views={[resolveServiceView(createService({ id: 'api' }), null, NOW, 'fix')]}
          project={createProject({ id: 'shop', name: 'Shop' })}
          now={NOW}
          handlers={handlers}
        />
      </TooltipProvider>
    );
    expect(screen.getByText('Services for SH-4')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Start api' }));
    expect(calls).toEqual(['start api fix']);
  });
});
