import { listTerminalPlaces, type ShinsaState } from '@shinsa/core';
import type { ServicesPanelActions } from '@/components/services/panel-views.tsx';
import type { ServiceHandlers } from '@/components/services/service-row.tsx';
import { requestWithToast } from '@/lib/connection/commands.ts';
import { hasEngineCommand, useEngineCommands } from '@/lib/connection/socket.ts';
import {
  openServiceTerminal,
  requestRefinedServiceSuggestions,
  requestServiceAdd,
  requestServiceSuggestions,
  requestServicesAdd,
  requestServicesRemove,
  requestServiceUpdate,
  restartService,
  startAllServices,
  startService,
  stopService,
  useTerminals,
} from '@/lib/connection/terminals.ts';
import { isPreviewShared, openPreviewShareDialog, resolvePreviewTarget } from '@/lib/share/previews.ts';
import {
  describeServicesAdded,
  describeServicesRemove,
  listServicePlaces,
  openServicePreview,
  resolveServiceForm,
} from '@/lib/terminal/services.ts';

export function useServiceActions({ state, onNavigate }: { state: ShinsaState; onNavigate?: () => void }) {
  const home = useTerminals()?.home ?? null;
  useEngineCommands();

  const handlers: ServiceHandlers = {
    start: (view) => void startService(view.service.id, view.taskId),
    stop: (view) => void stopService(view.service.id, view.taskId),
    restart: (view) => void restartService(view.service.id, view.taskId),
    startAll: (project) => void startAllServices(project.id),
    open: (view, project) => {
      if (!view.terminal) return;
      openServiceTerminal(project.key, view.terminal.id);
      onNavigate?.();
    },
    preview: openServicePreview,
    share: (view) => {
      const target = resolvePreviewTarget(view);
      if (target) openPreviewShareDialog(target);
    },
    canShare: (view) => hasEngineCommand('preview.share', view.taskId),
    sharing: (view) => {
      const task = view.taskId ? state.tasks[view.taskId] : undefined;
      return task ? isPreviewShared(task, view.service.id) : false;
    },
  };

  const actions: ServicesPanelActions = {
    home,
    focusForms: true,
    listPlaces: (projectId) => listServicePlaces(listTerminalPlaces(state, projectId)),
    listSuggestions: requestServiceSuggestions,
    refineSuggestions: requestRefinedServiceSuggestions,
    add: (projectId, inputs) =>
      requestWithToast(
        () => requestServicesAdd(projectId, inputs),
        describeServicesAdded(inputs.map((input) => input.name))
      ),
    addOne: (projectId, input) =>
      requestWithToast(() => requestServiceAdd(projectId, input), resolveServiceForm('add', input.name).done),
    update: (service, input) =>
      requestWithToast(
        () => requestServiceUpdate(service.id, input),
        resolveServiceForm('edit', input.name).done
      ),
    remove: (services) =>
      requestWithToast(
        () => requestServicesRemove(services.map((service) => service.id)),
        describeServicesRemove(services).done
      ),
  };

  return { handlers, actions };
}
