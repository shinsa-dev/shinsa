import { type ShinsaState, selectTaskByReference } from '@shinsa/core';
import { EmptyState } from '@shinsa/ui/components/empty-state';
import { SharedTaskPage } from '@/components/share/shared-task-page.tsx';
import { LoadingLine } from '@/components/status/loading-line.tsx';
import { useSharedView } from '@/hooks/use-shared-view.ts';
import { SHARED_PREVIEW_NOTE } from '@/lib/share/page.ts';
import { requestPreviewSource } from '@/lib/share/sources.ts';

export function SharePreviewPage({ state, reference }: { state: ShinsaState; reference: string }) {
  const task = selectTaskByReference(state, reference);
  const taskId = task?.id ?? reference;
  const load = useSharedView(`${taskId}:${task?.updatedAt ?? 0}`, (handlers) => {
    requestPreviewSource(taskId).then(handlers.onSource, handlers.onError);
    return () => undefined;
  });
  if (!task) {
    return <EmptyState icon='IconInboxEmpty' title='No such task' description='It may have been removed.' />;
  }
  if (load.status === 'loading') return <LoadingLine label='Preparing the preview' className='m-auto' />;
  if (load.status === 'error') {
    return <EmptyState icon='IconEyeSlash' title='The preview did not load' description={load.message} />;
  }
  return <SharedTaskPage view={load.view} note={SHARED_PREVIEW_NOTE} viewer={load.view.shared.owner} />;
}
