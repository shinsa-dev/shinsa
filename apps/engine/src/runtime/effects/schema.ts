import type { ShinsaEffect } from '@shinsa/core';
import { Duration, Schema } from 'effect';
import type { FeedbackDrafter } from '../../feedback/draft/service.ts';
import type { ServerInstance } from '../../instance/install.ts';
import type { HandoffEffects } from '../../remote/handoffs/schema.ts';
import type { PreviewEffects } from '../../remote/previews/schema.ts';
import type { ShareDescriber } from '../../remote/share-describe/service.ts';
import type { ShareEffects } from '../../remote/shares/schema.ts';
import type { LoginResolver, RootSource } from '../../repos/index.ts';
import type { ProcessTracker } from '../../resources/index.ts';
import type { WatchWriter } from '../../schedules/suggest.ts';
import type { Slack } from '../../slack/index.ts';
import type { Terminals } from '../../terminals/index.ts';
import type { RepositoryFinder, TriageResolver } from '../../triage/index.ts';
import type { Workspaces } from '../../workspaces/service.ts';

export interface EffectRunnerOptions {
  triage: TriageResolver;
  wordWatch?: WatchWriter;
  describeShare?: ShareDescriber['Service']['describe'];
  draftFeedback?: FeedbackDrafter['Service'];
  instance?: Pick<ServerInstance, 'version' | 'commit'>;
  timeZone?: string;
  findRepository?: RepositoryFinder;
  resolveLogin?: LoginResolver;
  roots?: RootSource;
  watchIntervalMs?: number;
  workspaces?: Workspaces['Service'];
  services?: TaskServices;
  shares: ShareEffects;
  previews: PreviewEffects;
  handoffs: HandoffEffects;
  slack?: Slack['Service'];
  trackProcess?: ProcessTracker;
}

export type TaskServices = Pick<Terminals['Service'], 'closeTaskTerminals' | 'listTerminalPids'>;

export type EffectOf<Kind extends ShinsaEffect['kind']> = Extract<ShinsaEffect, { kind: Kind }>;

export class HookRejected extends Schema.TaggedError<HookRejected, { readonly brand: unique symbol }>()(
  'HookRejected',
  { output: Schema.String }
) {}

export const WATCH_INTERVAL = Duration.seconds(45);

export const CANCELLED_COMMENT = 'Closed because its task was cancelled in Shinsa.';

export const FAILURE_TITLE: Partial<Record<ShinsaEffect['kind'], string>> = {
  'task.triage': 'Could not start the task',
  'config.verify': 'Could not verify the setup',
  'worktree.create': 'Could not set up the worktree',
  'checks.run': 'Could not run the checks',
  'pull_request.open': 'Could not open the pull request',
  'pull_request.push': 'Could not push the fixes',
  'pull_request.merge': 'Could not merge the pull request',
};

export const NO_TRIAGE = 'Shinsa could not read the request, so the task has no title or kind of work yet.';

export const TASK_GONE = 'The task or its repository no longer exists.';

export const NO_PULL_REQUEST = 'There is no pull request to merge.';

export const NOT_CREATED = 'GitHub did not return the new pull request.';

export const SLACK_DISCONNECTED = 'Slack is not connected on this machine.';

export const EDITS_COMMIT_MESSAGE = 'fix: apply the edits made in the Code tab';

export const RATE_LIMITED = /rate limit|HTTP 429/i;

export const NOT_MERGED_YET =
  'GitHub still shows the pull request as open after merging it. Retry to check it again and merge it.';
