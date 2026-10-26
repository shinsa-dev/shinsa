import type { ServiceView, ShinsaState, TerminalsSnapshot } from '@shinsa/core';
import { type CommandSection, RANK } from '@/lib/command/registry.ts';
import { listServiceCommands } from '@/lib/command/terminal.ts';
import { restartService, startAllServices, startService, stopService } from '@/lib/connection/terminals.ts';
import { listServiceGroups, resolveServicesProjects } from '@/lib/terminal/services.ts';

const ACTIONS = {
  startService: (view: ServiceView) => void startService(view.service.id),
  stopService: (view: ServiceView) => void stopService(view.service.id),
  restartService: (view: ServiceView) => void restartService(view.service.id),
};

export function listServiceSections(
  state: ShinsaState,
  snapshot: TerminalsSnapshot | null,
  now: number
): CommandSection[] {
  const groups = listServiceGroups(snapshot, resolveServicesProjects(state, null, now), now);
  const views = groups.flatMap((group) => group.views);
  if (views.length === 0) return [];
  const startAll = groups.flatMap((group) => {
    const stopped = group.views.filter((view) => view.state !== 'running' && view.state !== 'starting');
    if (stopped.length < 2) return [];
    return [
      {
        kind: 'run' as const,
        id: `service.start-all.${group.project.id}`,
        label: groups.length > 1 ? `Start all of ${group.project.name}’s services` : 'Start all services',
        icon: 'IconPlay' as const,
        keywords: ['services', 'dev', 'servers', 'run'],
        run: () => void startAllServices(group.project.id),
      },
    ];
  });
  return [
    {
      id: 'services',
      heading: 'Services',
      rank: RANK.global,
      commands: [...startAll, ...listServiceCommands(views, ACTIONS)],
    },
  ];
}
