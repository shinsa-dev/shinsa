import { describe, expect, it } from 'bun:test';
import { resolveServiceView } from '@shinsa/core';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ServiceHandlers } from '@/components/services/service-row.tsx';
import { TaskServicesPanel } from '@/components/services/task-menu.tsx';
import { createProject, NOW } from '../../support/state.ts';
import { createService, createTerminal } from '../../support/terminals.ts';

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
      preview: (view) => calls.push(`preview ${view.url}`),
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
    expect(screen.queryByRole('button', { name: 'Open api' })).toBeNull();
  });

  it('opens the preview of a task’s running service, never one that has stopped', () => {
    const calls: string[] = [];
    const noop = () => undefined;
    const handlers: ServiceHandlers = {
      start: noop,
      stop: noop,
      restart: noop,
      startAll: noop,
      open: (view) => calls.push(`open ${view.service.name}`),
      preview: (view) => calls.push(`preview ${view.url}`),
    };
    const service = createService({ id: 'web', previewUrl: 'http://localhost:{port}/tasks/SH-4' });
    const running = createTerminal({
      id: 't-web',
      serviceId: 'web',
      taskId: 'fix',
      port: 4123,
      startedAt: 0,
    });
    render(
      <TooltipProvider>
        <TaskServicesPanel
          task={{ handle: 'SH-4' }}
          views={[resolveServiceView(service, running, NOW)]}
          project={createProject({ id: 'shop', name: 'Shop' })}
          now={NOW}
          handlers={handlers}
        />
      </TooltipProvider>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Open web' }));
    expect(calls).toEqual(['preview http://localhost:4123/tasks/SH-4']);
  });

  it('shares the preview of a task’s running service, and marks one already shared', () => {
    const calls: string[] = [];
    const noop = () => undefined;
    const service = createService({ id: 'web', previewUrl: 'http://localhost:{port}/' });
    const running = createTerminal({
      id: 't-web',
      serviceId: 'web',
      taskId: 'fix',
      port: 4123,
      startedAt: 0,
    });
    const views = [resolveServiceView(service, running, NOW)];
    function show(shared: boolean) {
      return render(
        <TooltipProvider>
          <TaskServicesPanel
            task={{ handle: 'SH-4' }}
            views={views}
            project={createProject({ id: 'shop', name: 'Shop' })}
            now={NOW}
            handlers={{
              start: noop,
              stop: noop,
              restart: noop,
              startAll: noop,
              open: noop,
              preview: noop,
              share: (view) => calls.push(`share ${view.service.id} ${view.taskId}`),
              sharing: () => shared,
            }}
          />
        </TooltipProvider>
      );
    }
    const first = show(false);
    fireEvent.click(screen.getByRole('button', { name: 'Share preview' }));
    expect(calls).toEqual(['share web fix']);
    first.unmount();
    show(true);
    expect(screen.getByRole('button', { name: 'Sharing preview' })).toBeTruthy();
  });
});
