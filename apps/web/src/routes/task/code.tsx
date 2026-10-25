import type { Task } from '@shinsa/core';
import { EmptyState } from '@shinsa/ui/components/empty-state';
import { CodeLoading } from '@/components/code/code-loading.tsx';
import { requestCodeEditor } from '@/components/code/editor-pane.tsx';
import { Workbench } from '@/components/code/workbench.tsx';
import { tokenClient } from '@/lib/code/editor/tokens.ts';
import { useTaskRefs } from '@/lib/connection/code.ts';
import type { ExplorerMode } from '@/lib/tasks/tabs.ts';

export function CodeTab({ task, modes }: { task: Task; modes: ExplorerMode[] }) {
  const refs = useTaskRefs(task);
  if (refs.status === 'idle' || refs.status === 'loading') {
    return <CodeLoading label='Reading the code…' />;
  }
  if (refs.status === 'error') {
    return (
      <EmptyState size='sm' icon='IconFolder1' title='The code is not available' description={refs.message} />
    );
  }
  return <Workbench task={task} refs={refs.value} modes={modes} />;
}

export async function prefetchCodeEditor(path: string | null) {
  tokenClient.warm();
  const editor = await requestCodeEditor();
  if (path) await editor.requestLanguage(path);
}
