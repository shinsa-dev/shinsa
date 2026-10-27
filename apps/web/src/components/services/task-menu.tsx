import {
  listTaskServices,
  type Project,
  resolveTaskProject,
  type ServiceView,
  type ShinsaState,
  type Task,
} from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import { Popover, PopoverContent, PopoverTrigger } from '@shinsa/ui/components/popover';
import * as React from 'react';
import { CompactSections } from '@/components/layout/compact-section.tsx';
import { SERVICES_PANEL, ServicesTriggerLabel } from '@/components/services/menu.tsx';
import { PanelHeader } from '@/components/services/panel-views.tsx';
import { type ServiceHandlers, ServiceRow } from '@/components/services/service-row.tsx';
import { useServiceActions } from '@/components/services/use-service-actions.ts';
import { useNow } from '@/hooks/use-now.ts';
import { useTerminals } from '@/lib/connection/terminals.ts';
import { describeTaskServices } from '@/lib/terminal/services.ts';

export function TaskServicesPanel({
  task,
  views,
  project,
  now,
  handlers,
}: {
  task: Pick<Task, 'handle'>;
  views: ServiceView[];
  project: Project;
  now: number;
  handlers: ServiceHandlers;
}) {
  const copy = describeTaskServices(task);
  return (
    <>
      <PanelHeader title={copy.title} description={copy.description} />
      <CompactSections className='px-2 py-1.5'>
        {views.map((view) => (
          <ServiceRow key={view.service.id} view={view} project={project} now={now} handlers={handlers} />
        ))}
      </CompactSections>
    </>
  );
}

export function TaskServicesMenu({ state, task }: { state: ShinsaState; task: Task }) {
  const [open, setOpen] = React.useState(false);
  const snapshot = useTerminals();
  const now = useNow();
  const { handlers } = useServiceActions({ state, onNavigate: () => setOpen(false) });
  const views = listTaskServices(state, snapshot, task, now);
  const project = state.projects[resolveTaskProject(state, task) ?? ''];
  if (views.length === 0 || !project) return null;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={<Button variant='secondary' size='sm' data-task-services='' className='pl-1.5 text-fg-3' />}
      >
        <ServicesTriggerLabel views={views} active={open} variant='bar' />
      </PopoverTrigger>
      <PopoverContent align='end' sideOffset={6} className={SERVICES_PANEL}>
        <TaskServicesPanel task={task} views={views} project={project} now={now} handlers={handlers} />
      </PopoverContent>
    </Popover>
  );
}
