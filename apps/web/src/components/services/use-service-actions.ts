import { listTerminalPlaces, type ShinsaState } from '@shinsa/core';
import type { ServicesPanelActions } from '@/components/services/panel-views.tsx';
import type { ServiceHandlers } from '@/components/services/service-row.tsx';
import { requestWithToast } from '@/lib/connection/commands.ts';
import {
  openServiceTerminal,
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
import {
  describeServicesAdded,
  describeServicesRemove,
  listServicePlaces,
  resolveServiceForm,
} from '@/lib/terminal/services.ts';

export function useServiceActions({ state, onNavigate }: { state: ShinsaState; onNavigate?: () => void }) {
  const home = useTerminals()?.home ?? null;

  const handlers: ServiceHandlers = {
    start: (view) => void startService(view.service.id),
    stop: (view) => void stopService(view.service.id),
    restart: (view) => void restartService(view.service.id),
    startAll: (project) => void startAllServices(project.id),
    open: (view, project) => {
      if (!view.terminal) return;
      openServiceTerminal(project.key, view.terminal.id);
      onNavigate?.();
    },
  };

  const actions: ServicesPanelActions = {
    home,
    focusForms: true,
    listPlaces: (projectId) => listServicePlaces(listTerminalPlaces(state, projectId)),
    listSuggestions: requestServiceSuggestions,
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
