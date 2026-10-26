import type { Project, ServiceDefinition, ServiceSuggestion } from '@shinsa/core';
import { useDialogState } from '@shinsa/ui/hooks/use-dialog-state';
import { ConfirmDialog } from '@/components/overlays/confirm-dialog.tsx';
import { ServiceDialog } from '@/components/services/service-dialog.tsx';
import type { ServiceHandlers } from '@/components/services/service-row.tsx';
import { requestWithToast } from '@/lib/connection/commands.ts';
import {
  openServiceTerminal,
  removeService,
  requestServiceAdd,
  requestServiceUpdate,
  restartService,
  startService,
  stopService,
} from '@/lib/connection/terminals.ts';
import {
  createServiceDraft,
  describeServiceRemove,
  type ServiceDialogMode,
  type ServiceDraft,
} from '@/lib/terminal/services.ts';

interface Editing {
  mode: ServiceDialogMode;
  draft: ServiceDraft;
  projectId: string;
  serviceId: string | null;
}

export function useServiceActions({
  projects,
  onNavigate,
}: {
  projects: Project[];
  onNavigate?: () => void;
}) {
  const editing = useDialogState<Editing>();
  const removing = useDialogState<ServiceDefinition>();

  const handlers: ServiceHandlers = {
    start: (view) => void startService(view.service.id),
    stop: (view) => void stopService(view.service.id),
    restart: (view) => void restartService(view.service.id),
    open: (view, project) => {
      if (!view.terminal) return;
      openServiceTerminal(project.key, view.terminal.id);
      onNavigate?.();
    },
    edit: (view) =>
      editing.show({
        mode: 'edit',
        draft: createServiceDraft(view.service, null),
        projectId: view.service.projectId,
        serviceId: view.service.id,
      }),
    remove: (view) => removing.show(view.service),
  };

  const add = (projectId: string, from: ServiceSuggestion | null, path: string | null) =>
    editing.show({ mode: 'add', draft: createServiceDraft(from, path), projectId, serviceId: null });

  const addSuggestion = (projectId: string, suggestion: ServiceSuggestion) =>
    requestWithToast(
      () =>
        requestServiceAdd(projectId, {
          name: suggestion.name,
          cwd: suggestion.cwd,
          command: suggestion.command,
          env: {},
        }),
      `Added ${suggestion.name}.`
    );

  const dialogs = (
    <>
      {editing.value && (
        <ServiceDialog
          control={editing.control}
          mode={editing.value.mode}
          draft={editing.value.draft}
          projects={projects}
          projectId={editing.value.projectId}
          onSave={(projectId, input, done) => {
            const serviceId = editing.value?.serviceId;
            return requestWithToast(() => {
              if (serviceId) return requestServiceUpdate(serviceId, input);
              return requestServiceAdd(projectId, input);
            }, done);
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

  return { handlers, add, addSuggestion, dialogs };
}
