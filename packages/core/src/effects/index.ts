import { resolveSlackThreadKey, type SlackThreadRef } from '../domain/slack.ts';
import type { SlackMention } from '../slack/contract.ts';
import type { SlackPost } from '../slack/posts.ts';

export interface CheckToRun {
  id: string;
  label: string;
  command: string;
}

export type ShinsaEffect =
  | { kind: 'task.triage'; taskId: string }
  | { kind: 'worktree.create'; taskId: string }
  | { kind: 'run.execute'; runId: string }
  | { kind: 'run.cancel'; runId: string }
  | { kind: 'run.steer'; runId: string; text: string; from?: 'shinsa' }
  | { kind: 'question.resolve'; gateId: string }
  | { kind: 'checks.run'; taskId: string; round: number; checks: CheckToRun[]; coverage: boolean }
  | { kind: 'pull_request.open'; taskId: string }
  | { kind: 'pull_request.push'; taskId: string }
  | { kind: 'pull_request.merge'; taskId: string; headSha: string | null }
  | { kind: 'pull_request.watch'; taskId: string }
  | { kind: 'pull_request.close'; taskId: string; numbers: number[] }
  | { kind: 'worktree.remove'; taskId: string }
  | { kind: 'scratch.remove'; taskId: string }
  | { kind: 'config.verify'; taskId: string }
  | { kind: 'briefing.request'; projectId: string | null }
  | { kind: 'watch.suggest'; projectId: string; server: string; data: string }
  | { kind: 'run.wake'; runId: string; generation: number }
  | { kind: 'delegation.steer'; runId: string; generation: number }
  | { kind: 'delegation.reply'; runId: string; questionId: string }
  | { kind: 'share.link'; taskId: string }
  | { kind: 'slack.evaluate'; mention: SlackMention }
  | { kind: 'slack.status'; taskId: string; thread: SlackThreadRef }
  | { kind: 'slack.post'; thread: SlackThreadRef; taskId: string; post: SlackPost };

export type ShinsaEffectKind = ShinsaEffect['kind'];

export type EffectRecovery = 'process_bound' | 'replay_safe';

export const EFFECT_RECOVERY: Readonly<Record<ShinsaEffectKind, EffectRecovery>> = {
  'task.triage': 'replay_safe',
  'worktree.create': 'replay_safe',
  'run.execute': 'process_bound',
  'run.cancel': 'process_bound',
  'run.steer': 'process_bound',
  'question.resolve': 'process_bound',
  'checks.run': 'replay_safe',
  'pull_request.open': 'replay_safe',
  'pull_request.push': 'replay_safe',
  'pull_request.merge': 'replay_safe',
  'pull_request.watch': 'replay_safe',
  'pull_request.close': 'replay_safe',
  'worktree.remove': 'replay_safe',
  'scratch.remove': 'replay_safe',
  'config.verify': 'replay_safe',
  'briefing.request': 'replay_safe',
  'watch.suggest': 'replay_safe',
  'run.wake': 'process_bound',
  'delegation.steer': 'process_bound',
  'delegation.reply': 'process_bound',
  'share.link': 'replay_safe',
  'slack.evaluate': 'replay_safe',
  'slack.status': 'replay_safe',
  'slack.post': 'replay_safe',
};

function listEffectKinds(recovery: EffectRecovery) {
  return (Object.keys(EFFECT_RECOVERY) as ShinsaEffectKind[]).filter(
    (kind) => EFFECT_RECOVERY[kind] === recovery
  );
}

export const PROCESS_BOUND_EFFECTS: ReadonlySet<ShinsaEffectKind> = new Set(listEffectKinds('process_bound'));

export const REPLAY_SAFE_EFFECTS: ReadonlySet<ShinsaEffectKind> = new Set(listEffectKinds('replay_safe'));

export interface EffectCancellation {
  taskId: string;
  kinds: ShinsaEffectKind[];
  reason: string;
}

export function resolveEffectKey(effect: ShinsaEffect, seq: number) {
  switch (effect.kind) {
    case 'run.execute':
    case 'run.cancel':
      return `${effect.kind}:${effect.runId}`;
    case 'run.steer':
      return `${effect.kind}:${effect.runId}:${seq}`;
    case 'question.resolve':
      return `${effect.kind}:${effect.gateId}`;
    case 'run.wake':
    case 'delegation.steer':
      return `${effect.kind}:${effect.runId}:${effect.generation}`;
    case 'delegation.reply':
      return `${effect.kind}:${effect.runId}:${effect.questionId}`;
    case 'slack.evaluate':
      return `${effect.kind}:${effect.mention.eventId}`;
    case 'slack.status':
      return `${effect.kind}:${effect.taskId}:${seq}`;
    case 'slack.post':
      return `${effect.kind}:${resolveSlackThreadKey(effect.thread)}:${seq}`;
    case 'checks.run':
      return `${effect.kind}:${effect.taskId}:${effect.round}:${seq}`;
    case 'briefing.request':
      return `${effect.kind}:${effect.projectId ?? '*'}:${seq}`;
    case 'watch.suggest':
      return `${effect.kind}:${effect.projectId}:${effect.server}:${seq}`;
    case 'task.triage':
    case 'worktree.create':
    case 'worktree.remove':
    case 'scratch.remove':
    case 'config.verify':
    case 'pull_request.open':
    case 'pull_request.push':
    case 'pull_request.merge':
    case 'pull_request.watch':
    case 'pull_request.close':
    case 'share.link':
      return `${effect.kind}:${effect.taskId}:${seq}`;
  }
}

export function resolveEffectLane(effect: ShinsaEffect) {
  switch (effect.kind) {
    case 'briefing.request':
      return 'briefing';
    case 'watch.suggest':
      return `suggest:${effect.projectId}`;
    case 'run.execute':
    case 'run.wake':
      return `run:${effect.runId}`;
    case 'run.cancel':
      return `cancel:${effect.runId}`;
    case 'run.steer':
    case 'delegation.steer':
      return `steer:${effect.runId}`;
    case 'question.resolve':
      return `gate:${effect.gateId}`;
    case 'delegation.reply':
      return `reply:${effect.runId}`;
    case 'pull_request.watch':
      return `side:${effect.taskId}`;
    case 'share.link':
      return `share:${effect.taskId}`;
    case 'slack.evaluate':
      return `slack:${resolveSlackThreadKey(effect.mention)}`;
    case 'slack.post':
    case 'slack.status':
      return `slack:${resolveSlackThreadKey(effect.thread)}`;
    case 'task.triage':
    case 'worktree.create':
    case 'worktree.remove':
    case 'scratch.remove':
    case 'config.verify':
    case 'checks.run':
    case 'pull_request.open':
    case 'pull_request.push':
    case 'pull_request.merge':
    case 'pull_request.close':
      return `task:${effect.taskId}`;
  }
}
