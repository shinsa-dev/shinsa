import {
  CUSTOM_PRESET,
  isTaskSettled,
  type RemoteSnapshot,
  resolveShareLimit,
  resolveSharePreset,
  resolveShareScopes,
  resolveShareScopesPreset,
  type ResolvedPreset,
  type Settings,
  SHARE_PRESET_SCOPES,
  SHARE_REQUIRED_SCOPE,
  type ShareLimit,
  type SharePreset,
  type Task,
  type TaskShare,
  VIEW_SCOPES,
  type ViewScope,
} from '@shinsa/core';
import type { IconName } from '@shinsa/ui/components/icon';
import { useSyncExternalStore } from 'react';
import { sendCommandWithToast } from '@/lib/connection/commands.ts';
import { formatUntil } from '@/lib/format/time.ts';
import { canHandOff, HANDOFF_ICON, HANDOFF_TITLE, isTaskHandedOff } from '@/lib/share/handoff.ts';
import { createSignal } from '@/lib/signal.ts';

export const SHARE_TITLE = 'Share task';

export const UNSHARE_TITLE = 'Stop sharing';

export const SHARE_MANAGE_TITLE = 'Manage';

export const SHARING_NOTE = 'Anyone with the link can watch this task.';

export const SHARE_DESCRIPTION =
  'Anyone with the link can watch it live, read-only, while this machine is online.';

export const UNSHARE_DESCRIPTION = 'The link stops working at once, for everyone who has it.';

export const SHARE_LIMIT_TITLE = 'Share for';

export const SHARED_MARK_LABEL = 'Shared by link';

export const SHARING_SECTION = 'Sharing';

export const SHARING_SECTION_DESCRIPTION =
  'What a shared task shows and for how long, unless you pick otherwise.';

export const SHARE_LIMIT_SETTING = 'Share tasks for';

export const SHARE_PRESET_TITLE = 'Share as';

export const SHARE_PRESET_SETTING = 'Share tasks as';

export const SHARE_PRESET_ITEMS: { value: SharePreset; label: string; hint: string; icon: IconName }[] = [
  {
    value: 'status',
    label: 'Status',
    hint: 'Progress for customers, no names or code',
    icon: 'IconProgress75',
  },
  {
    value: 'standard',
    label: 'Standard',
    hint: 'The task and its agents’ live work',
    icon: 'IconListBullets',
  },
  { value: 'full', label: 'Full access', hint: 'Standard and your messages', icon: 'IconEyeOpen' },
];

export type ShareChoice = ResolvedPreset<SharePreset>;

export type ShareMode = ShareChoice | 'handoff';

const CUSTOM_MODE_ITEM: { value: ShareMode; label: string; hint: string; icon: IconName } = {
  value: CUSTOM_PRESET,
  label: 'Custom',
  hint: 'Only the parts you tick below',
  icon: 'IconSettingsSliderHor',
};

export const SHARE_SCOPE_ROWS: Readonly<Record<ViewScope, { title: string; hint: string }>> = {
  identity: { title: 'Title and status', hint: 'Always shown' },
  description: { title: 'Request', hint: 'What was asked, without attachments' },
  requests: { title: 'Later requests', hint: 'Each round’s request' },
  progress: { title: 'Progress', hint: 'The steps and where the task is' },
  summary: { title: 'Summary', hint: 'The agent’s summary of the work' },
  people: { title: 'People', hint: 'Who owns it and who worked on it' },
  plan: { title: 'Plan', hint: 'The plan and its phases' },
  reports: { title: 'Phase reports', hint: 'What each phase changed' },
  review: { title: 'Review', hint: 'The review report and findings' },
  evidence: { title: 'Evidence', hint: 'Screenshots, recordings and notes' },
  checks: { title: 'Checks', hint: 'Each check and its output' },
  pull_request: { title: 'Pull request', hint: 'The pull request and its branch' },
  activity: { title: 'Activity', hint: 'What happened, without messages' },
  code: { title: 'Code and diff', hint: 'The diff and the changed files' },
  runs: { title: 'Runs', hint: 'Each agent run, without its prompt' },
  live: { title: 'Live work', hint: 'The agents’ output and tool calls' },
  messages: { title: 'Your messages', hint: 'What you wrote to the agents' },
};

export const SHARE_SCOPES_TITLE = 'What the link shows';

export function listShareScopeRows() {
  return VIEW_SCOPES.map((scope) => ({
    scope,
    ...SHARE_SCOPE_ROWS[scope],
    required: scope === SHARE_REQUIRED_SCOPE,
  }));
}

export function toggleShareScope(scopes: readonly ViewScope[], scope: ViewScope, on: boolean) {
  if (scope === SHARE_REQUIRED_SCOPE) return resolveShareScopes(scopes);
  const rest = scopes.filter((item) => item !== scope);
  return resolveShareScopes(on ? [...rest, scope] : rest);
}

export function resolveShareChoice(scopes: readonly ViewScope[]): ShareChoice {
  return resolveShareScopesPreset(scopes);
}

export function resolveShareChoiceScopes(choice: ShareChoice, current: readonly ViewScope[]) {
  return choice === CUSTOM_PRESET ? resolveShareScopes(current) : SHARE_PRESET_SCOPES[choice];
}

const HANDOFF_MODE_ITEM: { value: ShareMode; label: string; hint: string; icon: IconName } = {
  value: 'handoff',
  label: HANDOFF_TITLE,
  hint: 'One person works on it from their own Shinsa',
  icon: HANDOFF_ICON,
};

export function listShareModeItems(task: Task, handoffSupported: boolean, scopesSupported = false) {
  const items: { value: ShareMode; label: string; hint: string; icon: IconName }[] = [...SHARE_PRESET_ITEMS];
  if (scopesSupported) items.push(CUSTOM_MODE_ITEM);
  return handoffSupported && canHandOff(task) ? [...items, HANDOFF_MODE_ITEM] : items;
}

export type ShareDialogFocus = 'share' | 'handoff';

export function resolveShareModeChoice(
  task: Task,
  settings: Settings | null,
  handoffSupported: boolean,
  focus: ShareDialogFocus | null = null
): ShareMode {
  const handing = handoffSupported && canHandOff(task);
  if (focus === 'handoff' && handing) return 'handoff';
  if (focus === null && !task.share && task.handoff && handing) return 'handoff';
  return resolveShareChoice(resolveShareScopesChoice(task, settings));
}

export function describeSharePreset(preset: ShareChoice) {
  if (preset === CUSTOM_PRESET) return CUSTOM_MODE_ITEM.label;
  return SHARE_PRESET_ITEMS.find((item) => item.value === preset)?.label ?? preset;
}

export const SHARE_LIMIT_ITEMS: { value: ShareLimit; label: string; icon: IconName }[] = [
  { value: 'until_done', label: 'Until the task is done', icon: 'IconCheckCircle2' },
  { value: 'hour', label: '1 hour', icon: 'IconClock' },
  { value: 'day', label: '24 hours', icon: 'IconClock' },
  { value: 'week', label: '7 days', icon: 'IconClock' },
  { value: 'none', label: 'Until you stop it', icon: 'IconInfinity' },
];

const FINISHED_TASK_LIMIT: ShareLimit = 'day';

export const SHARE_NEEDS_REMOTE =
  'A link reads this task from this machine through remote access. Turn it on in Settings, then share this task.';

export type ShareView =
  | { kind: 'unpaired' }
  | { kind: 'off' }
  | { kind: 'linking' }
  | { kind: 'failed'; message: string }
  | { kind: 'shared'; url: string };

const shareSignal = createSignal();

let sharing: string | null = null;

let sharingFocus: ShareDialogFocus | null = null;

let stopping: string | null = null;

export function openUnshareConfirm(taskId: string) {
  stopping = taskId;
  shareSignal.publish();
}

export function closeUnshareConfirm() {
  stopping = null;
  shareSignal.publish();
}

export function useUnshareConfirm() {
  return useSyncExternalStore(shareSignal.subscribe, () => stopping);
}

export function openShareDialog(taskId: string, focus: ShareDialogFocus | null = null) {
  sharing = taskId;
  sharingFocus = focus;
  shareSignal.publish();
}

export function closeShareDialog() {
  sharing = null;
  sharingFocus = null;
  shareSignal.publish();
}

export function useShareDialogFocus() {
  return useSyncExternalStore(shareSignal.subscribe, () => sharingFocus);
}

export function useShareDialog() {
  return useSyncExternalStore(shareSignal.subscribe, () => sharing);
}

export function selectLiveShare(task: Task, now = Date.now()) {
  const share = task.share;
  if (!share || (share.endsAt !== null && share.endsAt <= now)) return null;
  return share;
}

export function isTaskShared(task: Task, now = Date.now()) {
  const share = selectLiveShare(task, now);
  return Boolean(share?.url && !share.failure);
}

export function hasShareMark(task: Task, now = Date.now()) {
  return isTaskShared(task, now) || isTaskHandedOff(task);
}

export function resolveShareView(task: Task, remote: RemoteSnapshot | null, now = Date.now()): ShareView {
  const share = selectLiveShare(task, now);
  if (share?.failure) return { kind: 'failed', message: share.failure };
  if (share?.url) return { kind: 'shared', url: share.url };
  if (share) return { kind: 'linking' };
  if (remote && !remote.paired) return { kind: 'unpaired' };
  return { kind: 'off' };
}

export function listShareLimitItems(task: Task) {
  if (!isTaskSettled(task)) return SHARE_LIMIT_ITEMS;
  return SHARE_LIMIT_ITEMS.filter((item) => item.value !== 'until_done');
}

export function resolveShareLimitChoice(task: Task, settings: Settings): ShareLimit {
  const limit = task.share?.limit ?? resolveShareLimit(settings);
  return limit === 'until_done' && isTaskSettled(task) ? FINISHED_TASK_LIMIT : limit;
}

export function resolveShareScopesChoice(task: Task, settings: Settings | null): readonly ViewScope[] {
  if (task.share) return resolveShareScopes(task.share.scopes);
  return SHARE_PRESET_SCOPES[settings ? resolveSharePreset(settings) : 'standard'];
}

function resolveShareFields(scopes: readonly ViewScope[], scopesSupported: boolean) {
  if (scopesSupported) return { scopes: resolveShareScopes(scopes) };
  const choice = resolveShareChoice(scopes);
  return { preset: choice === CUSTOM_PRESET ? 'standard' : choice } as const;
}

function describeShareChange(scopes: readonly ViewScope[]) {
  const choice = resolveShareChoice(scopes);
  if (choice === CUSTOM_PRESET) return 'Sharing the parts you ticked.';
  return `Sharing as ${describeSharePreset(choice).toLowerCase()}.`;
}

export function describeShareEnd(share: TaskShare, now = Date.now()) {
  if (share.endsAt !== null) return formatUntil('Sharing ends', share.endsAt, now);
  if (share.limit === 'until_done') return 'Sharing ends when the task is done';
  return 'Shared until you stop it';
}

export function shareTask(
  task: Task,
  limit: ShareLimit,
  scopes: readonly ViewScope[],
  scopesSupported: boolean
) {
  return sendCommandWithToast({
    type: 'task.share',
    taskId: task.id,
    limit,
    ...resolveShareFields(scopes, scopesSupported),
  });
}

export function changeShareScopes(task: Task, scopes: readonly ViewScope[], scopesSupported: boolean) {
  return sendCommandWithToast(
    { type: 'task.share', taskId: task.id, ...resolveShareFields(scopes, scopesSupported) },
    describeShareChange(scopes)
  );
}

const SHARE_LIMIT_TOAST: Record<ShareLimit, string> = {
  until_done: 'Sharing until the task is done.',
  hour: 'Sharing for 1 hour.',
  day: 'Sharing for 24 hours.',
  week: 'Sharing for 7 days.',
  none: 'Sharing until you stop it.',
};

export function changeShareLimit(task: Task, limit: ShareLimit) {
  return sendCommandWithToast({ type: 'task.share', taskId: task.id, limit }, SHARE_LIMIT_TOAST[limit]);
}

export function unshareTask(task: Task) {
  return sendCommandWithToast({ type: 'task.unshare', taskId: task.id }, 'Stopped sharing.');
}
