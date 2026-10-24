import {
  describeDelegateRole,
  listRunningRuns,
  resolveSilenceLevel,
  resolveTaskRounds,
  type ShinsaState,
  type Task,
} from '@shinsa/core';
import { describeStopDelegation, listLiveDelegations } from '@/lib/chat/delegations.ts';
import { type Command, RANK } from '@/lib/command/registry.ts';
import { describeCheckInCount } from '@/lib/overview/wait.ts';
import {
  acceptSuggestion,
  dismissSilence,
  dismissSuggestion,
  keepSuggestion,
  requestCheckInNow,
  SNOOZE_HINT,
  snoozeSilence,
  stopDelegation,
} from '@/lib/tasks/process.ts';
import { changeRoundShipping, listShippingItems, ROUND_ICON } from '@/lib/tasks/rounds.ts';
import {
  listOpenSuggestions,
  listSuggestionStarts,
  SUGGESTION_START_LABEL,
} from '@/lib/tasks/suggestions.ts';

function listWaitCommands(task: Task): Command[] {
  if (task.monitor?.status !== 'armed') return [];
  return [
    {
      kind: 'run',
      id: `task.${task.id}.check-in-now`,
      label: 'Check in now',
      hint: describeCheckInCount(task.monitor),
      icon: 'IconStopwatch',
      keywords: ['wait', 'monitor', 'poll', 'wake', 'check', 'check in'],
      run: () => void requestCheckInNow(task.id),
    },
  ];
}

function listSilenceCommands(state: ShinsaState, task: Task, now: number): Command[] {
  return listRunningRuns(state, task.id).flatMap((run): Command[] => {
    const level = resolveSilenceLevel(state, run, now);
    if (level !== 'suspicious' && level !== 'critical') return [];
    const name = `the ${describeDelegateRole(run.role)}`;
    return [
      {
        kind: 'run',
        id: `task.${task.id}.silence.${run.id}.snooze`,
        label: `Snooze the quiet-agent warning on ${name}`,
        hint: SNOOZE_HINT,
        icon: 'IconBell2Snooze',
        keywords: ['silent', 'quiet', 'stalled', 'no output', 'snooze'],
        run: () => void snoozeSilence(run.id),
      },
      {
        kind: 'run',
        id: `task.${task.id}.silence.${run.id}.dismiss`,
        label: `Dismiss the quiet-agent warning on ${name}`,
        icon: 'IconCrossMedium',
        keywords: ['silent', 'quiet', 'stalled', 'no output', 'dismiss'],
        run: () => void dismissSilence(run.id),
      },
    ];
  });
}

function listSuggestionCommands(task: Task): Command[] {
  return listOpenSuggestions(task).flatMap((suggestion): Command[] => {
    const id = `task.${task.id}.suggestion.${suggestion.id}`;
    return [
      {
        kind: 'page',
        id: `${id}.accept`,
        label: `Add the suggested task “${suggestion.title}”`,
        hint: suggestion.why,
        icon: 'IconPlusMedium',
        keywords: ['suggested task', 'suggestion', 'roadmap', 'accept', 'add'],
        page: {
          kind: 'list',
          crumb: 'Add',
          placeholder: SUGGESTION_START_LABEL,
          sections: [
            {
              id: `${id}.start`,
              heading: SUGGESTION_START_LABEL,
              rank: RANK.context,
              commands: listSuggestionStarts(suggestion).map((item) => ({
                kind: 'run',
                id: `${id}.accept.${item.value}`,
                label: item.label,
                ...(item.hint ? { hint: item.hint } : {}),
                icon: item.icon,
                run: () => void acceptSuggestion(task, suggestion, item.value),
              })),
            },
          ],
        },
      },
      suggestion.splitOff
        ? {
            kind: 'run',
            id: `${id}.keep`,
            label: `Keep “${suggestion.title}” in this task`,
            hint: 'As the next round',
            icon: ROUND_ICON,
            keywords: ['split', 'separate', 'round', 'keep', 'decline'],
            run: () => void keepSuggestion(task, suggestion),
          }
        : {
            kind: 'run',
            id: `${id}.dismiss`,
            label: `Dismiss the suggested task “${suggestion.title}”`,
            icon: 'IconCrossMedium',
            keywords: ['suggested task', 'suggestion', 'dismiss'],
            run: () => void dismissSuggestion(task, suggestion),
          },
    ];
  });
}

function listRoundCommands(task: Task): Command[] {
  return resolveTaskRounds(task).flatMap((round): Command[] => {
    const items = listShippingItems(task, round) ?? [];
    return items
      .filter((item) => item.value !== round.shipping)
      .map((item) => ({
        kind: 'run',
        id: `task.${task.id}.round.${round.number}.${item.value}`,
        label: `Ship round ${round.number} ${item.value === 'stacked' ? 'as a stacked pull request' : item.label.toLowerCase()}`,
        hint: round.title,
        icon: item.value === 'stacked' ? 'IconLayersThree' : 'IconPullRequest',
        keywords: ['round', 'ship', 'stack', 'stacked', 'pull request'],
        run: () => void changeRoundShipping(task, round, item.value),
      }));
  });
}

function listDelegationCommands(state: ShinsaState, task: Task): Command[] {
  return listLiveDelegations(state, task.id).map((view) => ({
    kind: 'run',
    id: `task.${task.id}.delegation.${view.run.id}.stop`,
    label: describeStopDelegation(view),
    hint: view.role,
    icon: 'IconCrossSmall',
    keywords: ['delegated', 'delegation', 'stop', 'cancel', 'subtask'],
    run: () => void stopDelegation(view.run.id),
  }));
}

export function listProcessCommands(state: ShinsaState, task: Task, now: number): Command[] {
  return [
    ...listWaitCommands(task),
    ...listSilenceCommands(state, task, now),
    ...listDelegationCommands(state, task),
    ...listSuggestionCommands(task),
    ...listRoundCommands(task),
  ];
}
