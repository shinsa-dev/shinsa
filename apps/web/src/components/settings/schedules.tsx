import { listSchedules, type Schedule, type ShinsaState } from '@shinsa/core';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@shinsa/ui/components/dropdown-menu';
import { Truncate } from '@shinsa/ui/components/truncate';
import { useDialogState } from '@shinsa/ui/hooks/use-dialog-state';
import { cn } from '@shinsa/ui/lib/utils';
import { OptionsTrigger } from '@/components/controls/options-trigger.tsx';
import { ConfirmDialog } from '@/components/overlays/confirm-dialog.tsx';
import { TimeAgo } from '@/components/text/time-ago.tsx';
import { TONE_TEXT } from '@/lib/format/tone.ts';
import {
  canResume,
  copyWebhookUrl,
  describeNextRun,
  describeRemoval,
  describeScheduleSummary,
  removeSchedule,
  resolveScheduleStatus,
  resolveScheduleTaskId,
  updateScheduleEnabled,
} from '@/lib/schedules.ts';
import { navigate, resolveTaskPath, resolveTaskTarget } from '@/router.ts';
import { SETTING_ROW, SettingsEmpty, SettingsGroup } from './group.tsx';

export interface ScheduleActions {
  enable: (schedule: Schedule, enabled: boolean) => Promise<unknown>;
  copyWebhook: (schedule: Schedule) => Promise<unknown>;
  open: (taskId: string) => void;
  remove: (schedule: Schedule) => Promise<unknown>;
}

function ScheduleMenu({ schedule, actions }: { schedule: Schedule; actions: ScheduleActions }) {
  const removing = useDialogState<'remove'>();
  const taskId = resolveScheduleTaskId(schedule);
  const removal = describeRemoval(schedule);
  return (
    <>
      <DropdownMenu>
        <OptionsTrigger label='Schedule options' />
        <DropdownMenuContent align='end' className='min-w-52'>
          <DropdownMenuGroup>
            {schedule.enabled && (
              <DropdownMenuItem icon='IconPause' onClick={() => void actions.enable(schedule, false)}>
                Pause
              </DropdownMenuItem>
            )}
            {canResume(schedule) && (
              <DropdownMenuItem icon='IconPlay' onClick={() => void actions.enable(schedule, true)}>
                Resume
              </DropdownMenuItem>
            )}
            {schedule.trigger.kind === 'webhook' && (
              <DropdownMenuItem icon='IconClipboard2' onClick={() => void actions.copyWebhook(schedule)}>
                Copy webhook URL
              </DropdownMenuItem>
            )}
            {taskId && (
              <DropdownMenuItem icon='IconArrowUpRight' onClick={() => actions.open(taskId)}>
                Open the task
              </DropdownMenuItem>
            )}
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem icon='IconTrashCan' variant='destructive' onClick={() => removing.show('remove')}>
            Delete schedule
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {removing.value && (
        <ConfirmDialog
          control={removing.control}
          title={removal.title}
          body={removal.body}
          action='Delete schedule'
          onConfirm={() => void actions.remove(schedule)}
        />
      )}
    </>
  );
}

export function ScheduleRow({
  state,
  schedule,
  actions,
}: {
  state: ShinsaState;
  schedule: Schedule;
  actions: ScheduleActions;
}) {
  const status = resolveScheduleStatus(schedule);
  const at = status?.at ?? null;
  return (
    <div className={SETTING_ROW}>
      <div className='flex min-w-0 flex-1 flex-col gap-px'>
        <Truncate className='text-fg-4 text-xs'>{schedule.name}</Truncate>
        <Truncate className='text-2xs text-fg-2'>{describeScheduleSummary(state, schedule)}</Truncate>
      </div>
      <div className='flex shrink-0 items-center gap-1.5 text-xs'>
        {status && (
          <span className={cn('shrink-0', TONE_TEXT[status.tone])}>
            {at === null ? status.label : <TimeAgo at={at} text={(now) => describeNextRun(at, now)} />}
          </span>
        )}
        <ScheduleMenu schedule={schedule} actions={actions} />
      </div>
    </div>
  );
}

export function ScheduleSettings({ state }: { state: ShinsaState }) {
  const schedules = listSchedules(state);
  const actions: ScheduleActions = {
    enable: updateScheduleEnabled,
    copyWebhook: copyWebhookUrl,
    open: (taskId) => navigate(resolveTaskPath(resolveTaskTarget(state, taskId))),
    remove: removeSchedule,
  };
  return (
    <SettingsGroup title='Schedules'>
      {schedules.length === 0 && (
        <SettingsEmpty>
          Ask an agent to do something on a schedule or when a webhook is called, and it shows up here.
        </SettingsEmpty>
      )}
      {schedules.map((schedule) => (
        <ScheduleRow key={schedule.id} state={state} schedule={schedule} actions={actions} />
      ))}
    </SettingsGroup>
  );
}
