import type { Project, ServiceDefinition, ServiceView, ShinsaState } from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import { EmptyState } from '@shinsa/ui/components/empty-state';
import { Icon } from '@shinsa/ui/components/icon';
import { Popover, PopoverContent, PopoverTrigger } from '@shinsa/ui/components/popover';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import {
  COMPACT_POPOVER,
  COMPACT_POPOVER_INSET,
  CompactSection,
  CompactSections,
} from '@/components/layout/compact-section.tsx';
import { NAV_ITEM } from '@/components/layout/nav-item.tsx';
import {
  AddServicesView,
  CustomServiceView,
  EditServiceView,
  PANEL_FOOTER,
  type ServicesPanelActions,
} from '@/components/services/panel-views.tsx';
import {
  ManagedServiceRow,
  ServiceActionButton,
  type ServiceHandlers,
  ServiceRow,
  TaskRunRow,
} from '@/components/services/service-row.tsx';
import { useServiceActions } from '@/components/services/use-service-actions.ts';
import { ProjectDot } from '@/components/status/project-dot.tsx';
import { useNow } from '@/hooks/use-now.ts';
import { useTerminals } from '@/lib/connection/terminals.ts';
import { TONE_TEXT } from '@/lib/format/tone.ts';
import { resolveSettingsPath } from '@/lib/settings-tabs.ts';
import {
  canStartAll,
  describeRemoveServices,
  describeServiceGroup,
  describeServicesEmpty,
  describeServicesRemove,
  describeServicesTrigger,
  describeStartAll,
  listServiceGroups,
  resolveServiceGroupId,
  resolveServicesAddTarget,
  resolveServicesProjects,
  SERVICES_ACTIVE_ICON,
  SERVICES_ICON,
  type ServiceGroup,
  togglePick,
} from '@/lib/terminal/services.ts';
import {
  createServicesPanel,
  listPickedServices,
  reduceServicesPanel,
  resolveServicesPanelHeight,
  resolveShownServicesView,
  type ServicesPanelAction,
  type ServicesPanelHeight,
  type ServicesPanelState,
  type ServicesPanelView,
  selectEditedService,
  useServicesPanelRequest,
} from '@/lib/terminal/services-panel.ts';
import { resolveTerminalEntry, resolveTerminalProject } from '@/lib/terminal/tabs.ts';
import { navigate, useRoute, useSearchParam } from '@/router.ts';

function GroupSummary({ views }: { views: ServiceView[] }) {
  return describeServiceGroup(views).map((part) => (
    <span key={part.label} className={cn('truncate', part.tone !== 'neutral' && TONE_TEXT[part.tone])}>
      {part.label}
    </span>
  ));
}

function ServiceGroupSection({
  group,
  now,
  handlers,
  manage,
}: {
  group: ServiceGroup;
  now: number;
  handlers: ServiceHandlers;
  manage: ManageControl | null;
}) {
  return (
    <CompactSection
      persistId={resolveServiceGroupId(group.project.id)}
      label={group.project.name}
      leading={<ProjectDot color={group.project.color} />}
      title={group.project.name}
      count={<GroupSummary views={group.views} />}
      action={
        !manage &&
        canStartAll(group.views) && (
          <ServiceActionButton
            label={describeStartAll(group.project)}
            icon='IconPlay'
            onClick={() => handlers.startAll(group.project)}
          />
        )
      }
    >
      {group.views.map((view) =>
        manage ? (
          <ManagedServiceRow
            key={view.service.id}
            view={view}
            now={now}
            picked={manage.picked.includes(view.service.id)}
            onPick={() => manage.onPick(togglePick(manage.picked, view.service.id))}
            onEdit={() => manage.onEdit(view.service.id)}
          />
        ) : (
          <React.Fragment key={view.service.id}>
            <ServiceRow
              view={view}
              project={group.project}
              now={now}
              handlers={handlers}
              hasRuns={(group.runs?.[view.service.id]?.length ?? 0) > 0}
            />
            {group.runs?.[view.service.id]?.map((run, index, runs) => (
              <TaskRunRow
                key={run.view.terminal?.id ?? run.view.taskId}
                run={run}
                last={index === runs.length - 1}
                project={group.project}
                now={now}
                handlers={handlers}
              />
            ))}
          </React.Fragment>
        )
      )}
    </CompactSection>
  );
}

interface ManageControl {
  picked: string[];
  onPick: (picked: string[]) => void;
  onEdit: (serviceId: string) => void;
}

function ServicesEmpty({
  project,
  onCreateProject,
}: {
  project: Project | null;
  onCreateProject: (() => void) | null;
}) {
  const copy = describeServicesEmpty(project);
  return (
    <EmptyState icon={SERVICES_ICON} size='sm' title={copy.title} description={copy.description}>
      {onCreateProject && (
        <Button size='sm' icon='IconPlusMedium' onClick={onCreateProject}>
          Create a project…
        </Button>
      )}
    </EmptyState>
  );
}

export const SERVICES_PANEL = cn(
  COMPACT_POPOVER,
  'flex w-88 max-w-[calc(100vw-1rem)] flex-col overflow-hidden'
);

const VIEW_HEIGHT: Record<ServicesPanelHeight, string> = {
  content: '',
  fixed: 'h-[min(var(--available-height),28rem)]',
};

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

function ListFooter({
  onAdd,
  onManage,
  onTerminal,
}: {
  onAdd: (() => void) | null;
  onManage: (() => void) | null;
  onTerminal: () => void;
}) {
  return (
    <div className={PANEL_FOOTER}>
      <Button
        variant='secondary'
        size='sm'
        icon='IconSettingsSliderHor'
        disabled={!onManage}
        onClick={onManage ?? undefined}
      >
        Manage
      </Button>
      <Button
        variant='secondary'
        size='sm'
        icon='IconPlusMedium'
        disabled={!onAdd}
        onClick={onAdd ?? undefined}
      >
        Add…
      </Button>
      <span className='flex-1' />
      <Button variant='secondary' size='sm' icon='IconConsole' data-terminal-entry='' onClick={onTerminal}>
        Terminal
      </Button>
    </div>
  );
}

function ManageFooter({
  picked,
  confirming,
  onConfirm,
  onRemove,
  onDone,
}: {
  picked: ServiceDefinition[];
  confirming: boolean;
  onConfirm: (on: boolean) => void;
  onRemove: () => Promise<boolean>;
  onDone: () => void;
}) {
  const [busy, setBusy] = React.useState(false);
  if (confirming && picked.length > 0) {
    const copy = describeServicesRemove(picked);
    return (
      <div className={PANEL_FOOTER}>
        <span className='flex min-w-0 flex-1 flex-col ps-1.5'>
          <span className='truncate text-fg-4 text-xs'>{copy.question}</span>
          <span className='truncate text-2xs text-fg-2'>{copy.note}</span>
        </span>
        <Button variant='secondary' size='sm' onClick={() => onConfirm(false)}>
          Cancel
        </Button>
        <Button
          variant='destructive'
          size='sm'
          loading={busy}
          onClick={async () => {
            setBusy(true);
            await onRemove();
            setBusy(false);
          }}
        >
          Remove
        </Button>
      </div>
    );
  }
  return (
    <div className={PANEL_FOOTER}>
      <Button
        variant='destructive'
        size='sm'
        icon='IconTrashCan'
        disabled={picked.length === 0}
        onClick={() => onConfirm(true)}
      >
        {describeRemoveServices(picked.length)}
      </Button>
      <span className='flex-1' />
      <Button variant='secondary' size='sm' onClick={onDone}>
        Done
      </Button>
    </div>
  );
}

interface ServicesPanelProps {
  groups: ServiceGroup[];
  scope: Project[];
  now: number;
  handlers: ServiceHandlers;
  actions: ServicesPanelActions;
  panel: ServicesPanelState;
  onPanel: (action: ServicesPanelAction) => void;
  onCreateProject: () => void;
  onTerminal: () => void;
}

export function ServicesPanel(props: ServicesPanelProps) {
  const { groups, scope, panel } = props;
  const views = groups.flatMap((group) => group.views);
  const addProject = panel.projectId ?? resolveServicesAddTarget(scope, groups)?.id ?? null;
  const edited = selectEditedService(views, panel.editing);
  const shown = resolveShownServicesView(panel, addProject !== null, edited !== null, views.length === 0);
  return (
    <div className={cn('flex min-h-0 flex-col', VIEW_HEIGHT[resolveServicesPanelHeight(shown)])}>
      <ServicesPanelContent {...props} shown={shown} addProject={addProject} edited={edited} />
    </div>
  );
}

function ServicesPanelContent({
  groups,
  scope,
  now,
  handlers,
  actions,
  panel,
  onPanel,
  onCreateProject,
  onTerminal,
  shown,
  addProject,
  edited,
}: ServicesPanelProps & {
  shown: ServicesPanelView;
  addProject: string | null;
  edited: ServiceDefinition | null;
}) {
  const views = groups.flatMap((group) => group.views);
  const empty = views.length === 0;
  const addTarget = resolveServicesAddTarget(scope, groups);
  const onAdd = addTarget && (() => onPanel({ type: 'open', mode: 'add', projectId: addTarget.id }));
  const picked = listPickedServices(views, panel.picked);

  if (shown === 'add' && addProject)
    return (
      <AddServicesView
        projects={scope}
        projectId={addProject}
        actions={actions}
        onProject={(projectId) => onPanel({ type: 'project', projectId })}
        onCustom={() => onPanel({ type: 'custom' })}
        onBack={() => onPanel({ type: 'back' })}
        onDone={() => onPanel({ type: 'done' })}
      />
    );
  const emptyList = (
    <>
      <div className='flex flex-1 flex-col justify-center px-3 py-6'>
        <ServicesEmpty
          project={groups.length === 1 ? (groups[0]?.project ?? null) : null}
          onCreateProject={onAdd ? null : onCreateProject}
        />
      </div>
      <ListFooter onAdd={onAdd} onManage={null} onTerminal={onTerminal} />
    </>
  );
  if (shown === 'found' && addProject)
    return (
      <AddServicesView
        projects={scope}
        projectId={addProject}
        actions={actions}
        onProject={(projectId) => onPanel({ type: 'open', mode: 'add', projectId })}
        onCustom={() => {
          onPanel({ type: 'open', mode: 'add', projectId: addProject });
          onPanel({ type: 'custom' });
        }}
        onBack={null}
        onDone={() => onPanel({ type: 'done' })}
        empty={emptyList}
      />
    );
  if (shown === 'custom' && addProject)
    return (
      <CustomServiceView
        projectId={addProject}
        actions={actions}
        onBack={() => onPanel({ type: 'back' })}
        onDone={() => onPanel({ type: 'done' })}
      />
    );
  if (shown === 'edit' && edited)
    return <EditServiceView service={edited} actions={actions} onBack={() => onPanel({ type: 'back' })} />;

  async function removePicked() {
    const removed = await actions.remove(picked);
    if (removed) onPanel({ type: 'removed' });
    return removed;
  }

  const manage =
    panel.manage && !empty
      ? {
          picked: panel.picked,
          onPick: (next: string[]) => onPanel({ type: 'pick', picked: next }),
          onEdit: (serviceId: string) => onPanel({ type: 'edit', serviceId }),
        }
      : null;
  return (
    <>
      {empty ? (
        <div className='px-3 py-6'>
          <ServicesEmpty
            project={groups.length === 1 ? (groups[0]?.project ?? null) : null}
            onCreateProject={onAdd ? null : onCreateProject}
          />
        </div>
      ) : (
        <div className='min-h-0 overflow-y-auto'>
          <CompactSections
            className={cn(COMPACT_POPOVER_INSET, 'pb-0.5 has-[>section:last-of-type[data-folded]]:pb-1.5')}
          >
            {groups.map((group) => (
              <ServiceGroupSection
                key={group.project.id}
                group={group}
                now={now}
                handlers={handlers}
                manage={manage}
              />
            ))}
          </CompactSections>
        </div>
      )}
      {manage ? (
        <ManageFooter
          picked={picked}
          confirming={panel.confirming}
          onConfirm={(on) => onPanel({ type: 'confirm', on })}
          onRemove={removePicked}
          onDone={() => onPanel({ type: 'manage', on: false })}
        />
      ) : (
        <ListFooter
          onAdd={onAdd}
          onManage={empty ? null : () => onPanel({ type: 'manage', on: true })}
          onTerminal={onTerminal}
        />
      )}
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
  const [panel, dispatch] = React.useReducer(reduceServicesPanel, null, () =>
    createServicesPanel('list', null)
  );
  const route = useRoute();
  const onTerminal = route.name === 'terminal';
  const snapshot = useTerminals();
  const now = useNow();
  const terminalProject = resolveTerminalProject(state, useSearchParam('project'), now);
  const scope = resolveServicesProjects(state, onTerminal ? (terminalProject?.id ?? null) : null, now);
  const groups = listServiceGroups(snapshot, scope, now, state.tasks);
  const leave = () => {
    setOpen(false);
    onNavigate?.();
  };
  const { handlers, actions } = useServiceActions({ state, onNavigate: leave });

  useServicesPanelRequest((mode) => {
    dispatch({ type: 'open', mode, projectId: resolveServicesAddTarget(scope, groups)?.id ?? null });
    setOpen(true);
  });

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      onOpenChangeComplete={(shown) => {
        if (!shown) dispatch({ type: 'open', mode: 'list', projectId: null });
      }}
    >
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
        className={SERVICES_PANEL}
      >
        <ServicesPanel
          groups={groups}
          scope={scope}
          now={now}
          handlers={handlers}
          actions={actions}
          panel={panel}
          onPanel={dispatch}
          onCreateProject={() => {
            leave();
            navigate(resolveSettingsPath('projects'));
          }}
          onTerminal={() => {
            leave();
            navigate(resolveTerminalEntry());
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
