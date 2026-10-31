import { EmptyState } from '@shinsa/ui/components/empty-state';
import { SharedTaskPage } from '@/components/share/shared-task-page.tsx';
import { LoadingLine } from '@/components/status/loading-line.tsx';
import { useSharedView } from '@/hooks/use-shared-view.ts';
import { SHARED_READ_ONLY_NOTE } from '@/lib/share/page.ts';
import { requestPublicationSource } from '@/lib/share/sources.ts';

export function SharePage({ token }: { token: string }) {
  const load = useSharedView(token, () => requestPublicationSource(token));
  if (load.status === 'loading') return <LoadingLine label='Opening the shared task' className='m-auto' />;
  if (load.status === 'error') {
    return (
      <EmptyState
        icon='IconEyeSlash'
        title={load.gone ? 'This task is not shared' : 'The shared task did not load'}
        description={load.message}
      />
    );
  }
  return <SharedTaskPage view={load.view} note={SHARED_READ_ONLY_NOTE} />;
}
