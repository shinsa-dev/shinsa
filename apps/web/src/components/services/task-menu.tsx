import {
  listTaskServices,
  type Project,
  resolveTaskProject,
  type ServiceView,
  type ShinsaState,
  type Task,
} from '@shinsa/core';
import { Icon } from '@shinsa/ui/components/icon';
import { Popover, PopoverContent, PopoverTrigger } from '@shinsa/ui/components/popover';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import { CompactSections } from '@/components/layout/compact-section.tsx';
import { SERVICES_PANEL } from '@/components/services/menu.tsx';
import { PanelHeader } from '@/components/services/panel-views.tsx';
import { type ServiceHandlers, ServiceRow } from '@/components/services/service-row.tsx';
import { useServiceActions } from '@/components/services/use-service-actions.ts';
import { FACT, FACT_INTERACTIVE } from '@/components/task/fact.ts';
import { useNow } from '@/hooks/use-now.ts';
import { useTerminals } from '@/lib/connection/terminals.ts';
import { TONE_TEXT } from '@/lib/format/tone.ts';
import {
  describeTaskServices,
  describeTaskServicesFact,
  SERVICES_ACTIVE_ICON,
  SERVICES_ICON,
} from '@/lib/terminal/services.ts';

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
      <CompactSections className='p-1.5'>
        {views.map((view) => (
          <ServiceRow key={view.service.id} view={view} project={project} now={now} handlers={handlers} />
        ))}
      </CompactSections>
    </>
  );
}

export function TaskServicesFact({ state, task }: { state: ShinsaState; task: Task }) {
  const [open, setOpen] = React.useState(false);
  const snapshot = useTerminals();
  const now = useNow();
  const { handlers } = useServiceActions({ state, onNavigate: () => setOpen(false) });
  const views = listTaskServices(state, snapshot, task, now);
  const project = state.projects[resolveTaskProject(state, task) ?? ''];
  if (views.length === 0 || !project) return null;
  const fact = describeTaskServicesFact(views);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={<button type='button' data-task-services='' className={cn(FACT, FACT_INTERACTIVE)} />}
      >
        <Icon size='sm' name={open ? SERVICES_ACTIVE_ICON : SERVICES_ICON} />
        <span className={cn('tabular-nums', fact.tone !== 'neutral' && TONE_TEXT[fact.tone])}>
          {fact.label}
        </span>
      </PopoverTrigger>
      <PopoverContent align='start' sideOffset={6} className={SERVICES_PANEL}>
        <TaskServicesPanel task={task} views={views} project={project} now={now} handlers={handlers} />
      </PopoverContent>
    </Popover>
  );
}
