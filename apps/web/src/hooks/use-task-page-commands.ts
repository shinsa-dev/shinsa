import type { ShinsaState, Task } from '@shinsa/core';
import { useReviewDraft } from '@/hooks/use-review-draft.ts';
import type { TaskView } from '@/hooks/use-task-view.ts';
import { useRegisterCommands } from '@/lib/command/registry.ts';
import { listTaskPageSections } from '@/lib/command/task.ts';
import { useAccounts } from '@/lib/connection/accounts.ts';
import { useEngineFeature } from '@/lib/connection/socket.ts';
import { canMergeAhead, resolveFollowUp } from '@/lib/overview/verdicts.ts';

export function useTaskPageCommands(state: ShinsaState, task: Task, view: TaskView) {
  const draft = useReviewDraft();
  const accounts = useAccounts();
  const approveAfterFix = useEngineFeature('review.approve_after_fix', task.id);
  const approveAndMerge = useEngineFeature('review.approve_and_merge', task.id);
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
        verdicts: draft.verdicts,
        followUp: {
          chosen: resolveFollowUp(draft.thenApprove, draft.thenMerge),
          support: { approveAfterFix, approveAndMerge: approveAndMerge && canMergeAhead(state, task) },
        },
      },
      accounts
    )
  );
}
