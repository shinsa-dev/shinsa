import { listSchedules, type Schedule, type ShinsaState } from '@shinsa/core';
import { type Command, type CommandSection, RANK } from '@/lib/command/registry.ts';
import { openSettingsSection } from '@/lib/command/settings.ts';
import {
  canResume,
  copyWebhookUrl,
  describeRemoval,
  describeScheduleWhen,
  removeSchedule,
  resolveScheduleIcon,
  resolveScheduleTaskId,
  updateScheduleEnabled,
} from '@/lib/schedules.ts';
import { resolveTaskPath, resolveTaskTarget } from '@/router.ts';

function createRemoveCommand(schedule: Schedule): Command {
  const id = `schedule.${schedule.id}`;
  const removal = describeRemoval(schedule);
  return {
    kind: 'page',
    id: `${id}.delete`,
    label: 'Delete schedule',
    icon: 'IconTrashCan',
    destructive: true,
    keywords: ['remove'],
    page: {
      kind: 'list',
      crumb: 'Delete',
      placeholder: removal.title,
      sections: [
        {
          id: 'confirm',
          heading: removal.body,
          rank: RANK.context,
          commands: [
            {
              kind: 'run',
              id: `${id}.delete.confirm`,
              label: 'Delete schedule',
              icon: 'IconTrashCan',
              destructive: true,
              run: () => void removeSchedule(schedule),
            },
            { kind: 'run', id: `${id}.delete.keep`, label: 'Keep it', icon: 'IconArrowLeft', run: () => {} },
          ],
        },
      ],
    },
  };
}

function listToggleCommands(schedule: Schedule): Command[] {
  const id = `schedule.${schedule.id}`;
  const commands: Command[] = [];
  if (schedule.enabled) {
    commands.push({
      kind: 'run',
      id: `${id}.pause`,
      label: 'Pause',
      icon: 'IconPause',
      keywords: ['stop', 'hold'],
      run: () => void updateScheduleEnabled(schedule, false),
    });
  }
  if (canResume(schedule)) {
    commands.push({
      kind: 'run',
      id: `${id}.resume`,
      label: 'Resume',
      icon: 'IconPlay',
      keywords: ['start', 'unpause'],
      run: () => void updateScheduleEnabled(schedule, true),
    });
  }
  return commands;
}

function listActions(state: ShinsaState, schedule: Schedule): Command[] {
  const id = `schedule.${schedule.id}`;
  const taskId = resolveScheduleTaskId(schedule);
  const commands = listToggleCommands(schedule);
  if (schedule.trigger.kind === 'webhook') {
    commands.push({
      kind: 'run',
      id: `${id}.copy`,
      label: 'Copy webhook URL',
      icon: 'IconClipboard2',
      keywords: ['link', 'hook'],
      run: () => void copyWebhookUrl(schedule),
    });
  }
  if (taskId) {
    commands.push({
      kind: 'go',
      id: `${id}.task`,
      label: 'Open the task',
      icon: 'IconArrowUpRight',
      to: resolveTaskPath(resolveTaskTarget(state, taskId)),
    });
  }
  commands.push(createRemoveCommand(schedule));
  return commands;
}

function createScheduleCommand(state: ShinsaState, schedule: Schedule): Command {
  return {
    kind: 'page',
    id: `schedule.${schedule.id}`,
    label: schedule.name,
    hint: describeScheduleWhen(schedule),
    icon: resolveScheduleIcon(schedule),
    keywords: ['schedule', 'trigger', schedule.trigger.kind],
    page: {
      kind: 'list',
      crumb: schedule.name,
      placeholder: 'Do what with this schedule?',
      sections: [
        {
          id: `schedule.${schedule.id}.actions`,
          heading: schedule.name,
          rank: RANK.context,
          commands: listActions(state, schedule),
        },
      ],
    },
  };
}

export function listScheduleSections(state: ShinsaState): CommandSection[] {
  const schedules = listSchedules(state);
  if (schedules.length === 0) return [];
  return [
    {
      id: 'global.schedules',
      heading: 'Schedules',
      rank: RANK.global + 4,
      commands: [
        {
          kind: 'run',
          id: 'schedules.open',
          label: 'Schedules',
          icon: 'IconClock',
          keywords: ['schedules', 'webhooks', 'triggers', 'settings'],
          run: () => openSettingsSection('Schedules'),
        },
        ...schedules.map((schedule) => ({ ...createScheduleCommand(state, schedule), searchOnly: true })),
      ],
    },
  ];
}
