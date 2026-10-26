import { listTerminalPlaces, type ServiceDefinition, type ShinsaState } from '@shinsa/core';
import { useDialogState } from '@shinsa/ui/hooks/use-dialog-state';
import { ConfirmDialog } from '@/components/overlays/confirm-dialog.tsx';
import { AddServicesDialog, EditServiceDialog } from '@/components/services/service-dialog.tsx';
import type { ServiceHandlers } from '@/components/services/service-row.tsx';
import { requestWithToast } from '@/lib/connection/commands.ts';
import {
  openServiceTerminal,
  removeService,
  requestServiceAdd,
  requestServicesAdd,
  requestServiceUpdate,
  restartService,
  startService,
  stopService,
  useTerminals,
} from '@/lib/connection/terminals.ts';
import { listProjects } from '@/lib/projects.ts';
import {
  createServiceDraft,
  describeServiceRemove,
  describeServicesAdded,
  listServicePlaces,
  resolveServiceDialog,
} from '@/lib/terminal/services.ts';

export function useServiceActions({ state, onNavigate }: { state: ShinsaState; onNavigate?: () => void }) {
  const adding = useDialogState<string>();
  const editing = useDialogState<ServiceDefinition>();
  const removing = useDialogState<ServiceDefinition>();
  const home = useTerminals()?.home ?? null;
  const listPlaces = (projectId: string) => listServicePlaces(listTerminalPlaces(state, projectId));

  const handlers: ServiceHandlers = {
    start: (view) => void startService(view.service.id),
    stop: (view) => void stopService(view.service.id),
    restart: (view) => void restartService(view.service.id),
    open: (view, project) => {
      if (!view.terminal) return;
      openServiceTerminal(project.key, view.terminal.id);
      onNavigate?.();
    },
    edit: (view) => editing.show(view.service),
    remove: (view) => removing.show(view.service),
  };

  const add = (projectId: string) => adding.show(projectId);

  const dialogs = (
    <>
      {adding.value && (
        <AddServicesDialog
          control={adding.control}
          projects={listProjects(state)}
          projectId={adding.value}
          home={home}
          listPlaces={listPlaces}
          onAdd={(projectId, inputs) =>
            requestWithToast(
              () => requestServicesAdd(projectId, inputs),
              describeServicesAdded(inputs.map((input) => input.name))
            )
          }
          onAddOne={(projectId, input) =>
            requestWithToast(
              () => requestServiceAdd(projectId, input),
              resolveServiceDialog('add', input.name).done
            )
          }
        />
      )}
      {editing.value && (
        <EditServiceDialog
          control={editing.control}
          draft={createServiceDraft(editing.value)}
          places={listPlaces(editing.value.projectId)}
          home={home}
          onSave={(input, done) => {
            const id = editing.value?.id ?? '';
            return requestWithToast(() => requestServiceUpdate(id, input), done);
          }}
        />
      )}
      {removing.value && (
        <ConfirmDialog
          control={removing.control}
          title={`Remove ${removing.value.name}?`}
          body={describeServiceRemove(removing.value)}
          action='Remove service'
          onConfirm={() => {
            if (removing.value) void removeService(removing.value.id);
          }}
        />
      )}
    </>
  );

  return { handlers, add, dialogs };
}
