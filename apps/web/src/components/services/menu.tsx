import type { ServiceView, ShinsaState } from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import { HoverHighlight } from '@shinsa/ui/components/highlight-list';
import { Icon } from '@shinsa/ui/components/icon';
import { Popover, PopoverContent, PopoverTrigger } from '@shinsa/ui/components/popover';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import { NAV_ITEM } from '@/components/layout/nav-item.tsx';
import { type ServiceHandlers, ServiceRow } from '@/components/services/service-row.tsx';
import { useServiceActions } from '@/components/services/use-service-actions.tsx';
import { ProjectDot } from '@/components/status/project-dot.tsx';
import { useNow } from '@/hooks/use-now.ts';
import { startAllServices, useTerminals } from '@/lib/connection/terminals.ts';
import { TONE_TEXT } from '@/lib/format/tone.ts';
import {
  describeServicesTrigger,
  listServiceGroups,
  resolveServicesAddTarget,
  resolveServicesProjects,
  SERVICES_ACTIVE_ICON,
  SERVICES_ICON,
  type ServiceGroup,
} from '@/lib/terminal/services.ts';
import { resolveTerminalEntry, resolveTerminalProject } from '@/lib/terminal/tabs.ts';
import { navigate, useRoute, useSearchParam } from '@/router.ts';

function GroupHeader({ group }: { group: ServiceGroup }) {
  const stopped = group.views.filter((view) => view.state !== 'running' && view.state !== 'starting');
  return (
    <div className='flex h-8 items-center gap-2 ps-2.5 pe-1.5'>
      <ProjectDot color={group.project.color} />
      <span className='min-w-0 flex-1 truncate font-medium text-fg-3 text-xs'>{group.project.name}</span>
      {stopped.length > 1 && (
        <Button
          variant='secondary'
          size='xs'
          icon='IconPlay'
          onClick={() => void startAllServices(group.project.id)}
        >
          Start all
        </Button>
      )}
    </div>
  );
}

export function ServicesTriggerLabel({
  views,
  active,
  variant,
}: {
  views: ServiceView[];
  active: boolean;
  variant: 'bar' | 'rail';
}) {
  const trigger = describeServicesTrigger(views);
  const icon = (
    <Icon name={active ? SERVICES_ACTIVE_ICON : SERVICES_ICON} size={variant === 'rail' ? 'md' : 'sm'} />
  );
  const label = (
    <span className={cn('tabular-nums', trigger.tone !== 'neutral' && TONE_TEXT[trigger.tone])}>
      {trigger.label}
    </span>
  );
  if (variant === 'bar')
    return (
      <span className='flex items-center gap-1'>
        {icon}
        {label}
      </span>
    );
  return (
    <>
      <span className='grid size-5 shrink-0 place-items-center'>{icon}</span>
      <span className='flex-1 truncate'>Services</span>
      {trigger.label !== 'Services' && <span className='text-2xs'>{label}</span>}
    </>
  );
}

export function ServicesPanel({
  groups,
  now,
  handlers,
  footer,
}: {
  groups: ServiceGroup[];
  now: number;
  handlers: ServiceHandlers;
  footer: React.ReactNode;
}) {
  return (
    <>
      {groups.map((group, index) => (
        <section
          key={group.project.id}
          className={cn('flex flex-col pb-1', index > 0 && 'border-border border-t')}
        >
          <GroupHeader group={group} />
          {group.views.length === 0 ? (
            <p className='px-2.5 pb-2 text-2xs text-fg-2'>No services yet.</p>
          ) : (
            <HoverHighlight className='flex flex-col gap-px px-1'>
              {group.views.map((view) => (
                <ServiceRow
                  key={view.service.id}
                  view={view}
                  project={group.project}
                  now={now}
                  handlers={handlers}
                />
              ))}
            </HoverHighlight>
          )}
        </section>
      ))}
      {groups.length === 0 && <p className='px-2.5 py-2 text-2xs text-fg-2'>No services yet.</p>}
      <div className='flex items-center gap-1 border-border border-t p-1.5'>{footer}</div>
    </>
  );
}

export function ServicesMenu({
  state,
  variant = 'bar',
  onNavigate,
}: {
  state: ShinsaState;
  variant?: 'bar' | 'rail';
  onNavigate?: () => void;
}) {
  const [open, setOpen] = React.useState(false);
  const route = useRoute();
  const onTerminal = route.name === 'terminal';
  const snapshot = useTerminals();
  const now = useNow();
  const terminalProject = resolveTerminalProject(state, useSearchParam('project'), now);
  const scope = resolveServicesProjects(state, onTerminal ? (terminalProject?.id ?? null) : null, now);
  const groups = listServiceGroups(snapshot, scope, now);
  const close = () => setOpen(false);
  const leave = () => {
    close();
    onNavigate?.();
  };
  const actions = useServiceActions({ state, onNavigate: leave });
  const addTarget = resolveServicesAddTarget(scope, groups);

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            variant === 'rail' ? (
              <button
                type='button'
                data-services-trigger=''
                data-active={onTerminal}
                aria-current={onTerminal ? 'page' : undefined}
                className={NAV_ITEM}
              />
            ) : (
              <Button
                variant='secondary'
                size='sm'
                data-services-trigger=''
                aria-current={onTerminal ? 'page' : undefined}
                icon={{ name: 'IconChevronDownSmall', position: 'inline-end' }}
                className={cn('pl-1.5', onTerminal ? 'text-fg-4' : 'text-fg-3')}
              />
            )
          }
        >
          <ServicesTriggerLabel
            views={groups.flatMap((group) => group.views)}
            active={onTerminal}
            variant={variant}
          />
        </PopoverTrigger>
        <PopoverContent
          align='start'
          side={variant === 'rail' ? 'right' : 'bottom'}
          sideOffset={6}
          collisionAvoidance={{ fallbackAxisSide: 'none' }}
          className='max-h-(--available-height) w-96 max-w-[calc(100vw-1rem)] gap-0 overflow-y-auto p-0 [--glyph-ring:var(--color-popover)]'
        >
          <ServicesPanel
            groups={groups}
            now={now}
            handlers={actions.handlers}
            footer={
              <>
                {addTarget && (
                  <Button
                    variant='secondary'
                    size='sm'
                    icon='IconPlusMedium'
                    onClick={() => {
                      close();
                      actions.add(addTarget.id);
                    }}
                  >
                    Add services…
                  </Button>
                )}
                <span className='flex-1' />
                <Button
                  variant='secondary'
                  size='sm'
                  icon='IconConsole'
                  data-terminal-entry=''
                  onClick={() => {
                    leave();
                    navigate(resolveTerminalEntry());
                  }}
                >
                  Terminal
                </Button>
              </>
            }
          />
        </PopoverContent>
      </Popover>
      {actions.dialogs}
    </>
  );
}
