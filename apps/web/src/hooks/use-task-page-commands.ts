import type { ShinsaState, Task } from '@shinsa/core';
import { useReviewDraft } from '@/hooks/use-review-draft.ts';
import type { TaskView } from '@/hooks/use-task-view.ts';
import { useRegisterCommands } from '@/lib/command/registry.ts';
import { listTaskPageSections } from '@/lib/command/task.ts';
import { useAccounts } from '@/lib/connection/accounts.ts';

export function useTaskPageCommands(state: ShinsaState, task: Task, view: TaskView) {
  const draft = useReviewDraft();
  const accounts = useAccounts();
  useRegisterCommands(
    listTaskPageSections(
      state,
      task,
      {
        tab: view.tab,
        tabs: view.tabs,
        applyTab: view.applyTab,
        comments: draft.comments,
        clearComments: draft.clearComments,
      },
      accounts
    )
  );
}
