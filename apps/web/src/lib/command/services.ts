import type { ServiceView, ShinsaState, TerminalsSnapshot } from '@shinsa/core';
import { type CommandSection, RANK } from '@/lib/command/registry.ts';
import { listServiceCommands } from '@/lib/command/terminal.ts';
import { restartService, startAllServices, startService, stopService } from '@/lib/connection/terminals.ts';
import { describeStartAll, listServiceGroups, resolveServicesProjects } from '@/lib/terminal/services.ts';
import { requestServicesPanel } from '@/lib/terminal/services-panel.ts';

const ACTIONS = {
  startService: (view: ServiceView) => void startService(view.service.id, view.taskId),
  stopService: (view: ServiceView) => void stopService(view.service.id, view.taskId),
  restartService: (view: ServiceView) => void restartService(view.service.id, view.taskId),
};

export function listServiceSections(
  state: ShinsaState,
  snapshot: TerminalsSnapshot | null,
  now: number
): CommandSection[] {
  const scope = resolveServicesProjects(state, null, now);
  const groups = listServiceGroups(snapshot, scope, now);
  const views = groups.flatMap((group) => group.views);
  if (scope.length === 0) return [];
  const startAll = groups.flatMap((group) => {
    const stopped = group.views.filter((view) => view.state !== 'running' && view.state !== 'starting');
    if (stopped.length < 2) return [];
    return [
      {
        kind: 'run' as const,
        id: `service.start-all.${group.project.id}`,
        label: groups.length > 1 ? describeStartAll(group.project) : 'Start all services',
        icon: 'IconPlay' as const,
        keywords: ['services', 'dev', 'servers', 'run'],
        run: () => void startAllServices(group.project.id),
      },
    ];
  });
  const add = {
    kind: 'run' as const,
    id: 'service.add',
    label: 'Add services…',
    icon: 'IconPlusMedium' as const,
    keywords: ['services', 'new', 'dev', 'servers', 'find'],
    run: () => requestServicesPanel('add'),
  };
  const manage = {
    kind: 'run' as const,
    id: 'service.manage',
    label: 'Manage services…',
    icon: 'IconSettingsSliderHor' as const,
    keywords: ['services', 'remove', 'delete', 'edit', 'change'],
    run: () => requestServicesPanel('manage'),
  };
  return [
    {
      id: 'services',
      heading: 'Services',
      rank: RANK.global,
      commands: [
        ...startAll,
        add,
        ...(views.length > 0 ? [manage] : []),
        ...listServiceCommands(views, ACTIONS),
      ],
    },
  ];
}
