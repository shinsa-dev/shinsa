import type { SeedTask } from '../kit.ts';
import type { SeedRepos, SeedWorktrees } from '../workspace.ts';
import { listActiveTasks } from './active.ts';
import { listBacklogTasks } from './backlog.ts';
import { listBasketTasks } from './basket.ts';
import { listBundleTasks } from './bundles.ts';
import { listDelegationTasks } from './delegation.ts';
import { listEmbeddedChatTasks } from './embedded-chat.ts';
import { listHistoryTasks } from './history.ts';
import { listMergeStepTasks } from './merge-steps.ts';
import { listPersonalTasks } from './personal.ts';
import { listProcessTasks } from './process.ts';
import { listReviewTasks } from './review.ts';
import { listRoundTasks } from './rounds.ts';
import { listShapeTasks } from './shapes.ts';
import { listTriggerTasks } from './triggers.ts';

export function listTasks(repos: SeedRepos, worktrees: SeedWorktrees): SeedTask[] {
  const { paywall, kanna, basketSdk, basketServer } = repos;
  return [
    ...listEmbeddedChatTasks(repos, worktrees),
    ...listBacklogTasks(repos),
    ...listReviewTasks(repos, worktrees),
    ...listActiveTasks(repos),
    ...listPersonalTasks(repos, worktrees),
    ...listBasketTasks({ basketServer, basketSdk }),
    ...listProcessTasks({ paywall, kanna }, worktrees.exportBackoff),
    ...listShapeTasks({ paywall, kanna }),
    ...listDelegationTasks({ paywall }),
    ...listTriggerTasks({ paywall, kanna }),
    ...listRoundTasks({ paywall }, worktrees.rounds),
    ...listMergeStepTasks({ paywall, kanna }),
    ...listBundleTasks({ paywall }),
    ...listHistoryTasks(paywall),
  ];
}
