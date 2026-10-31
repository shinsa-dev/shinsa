import type { ShareLink } from '@shinsa/core';
import { EmptyState } from '@shinsa/ui/components/empty-state';
import * as React from 'react';
import { SharedTaskPage } from '@/components/share/shared-task-page.tsx';
import { LoadingLine } from '@/components/status/loading-line.tsx';
import { useSharedView } from '@/hooks/use-shared-view.ts';
import { openShareStream } from '@/lib/share/live.ts';
import { SHARED_READ_ONLY_NOTE } from '@/lib/share/page.ts';
import { requestViewerLogin, SHARE_GONE } from '@/lib/share/sources.ts';

export function SharePage({ link }: { link: ShareLink | null }) {
  if (!link)
    return <EmptyState icon='IconEyeSlash' title='This task is not shared' description={SHARE_GONE} />;
  return <LiveSharePage link={link} />;
}

function LiveSharePage({ link }: { link: ShareLink }) {
  const load = useSharedView(`${link.instanceId}/${link.shareId}`, (handlers) =>
    openShareStream(link, handlers)
  );
  const [viewer, setViewer] = React.useState<string | null>(null);
  React.useEffect(() => {
    void requestViewerLogin().then(setViewer);
  }, []);
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
  return <SharedTaskPage view={load.view} note={SHARED_READ_ONLY_NOTE} viewer={viewer} />;
}
