import { listOpenWatchSuggestions, listSchedules, type Schedule, type ShinsaState } from '@shinsa/core';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@shinsa/ui/components/dropdown-menu';
import { Icon } from '@shinsa/ui/components/icon';
import { Truncate } from '@shinsa/ui/components/truncate';
import { useDialogState } from '@shinsa/ui/hooks/use-dialog-state';
import { cn } from '@shinsa/ui/lib/utils';
import { SuggestedWatchRow } from '@/components/automations/suggested-watch.tsx';
import { OptionsTrigger } from '@/components/controls/options-trigger.tsx';
import { ConfirmDialog } from '@/components/overlays/confirm-dialog.tsx';
import { StatusTile } from '@/components/status/tile.tsx';
import { TimeAgo } from '@/components/text/time-ago.tsx';
import { TONE_TEXT } from '@/lib/format/tone.ts';
import {
  AUTOMATION_TYPE_LOOK,
  canResume,
  copyWebhookUrl,
  describeNextRun,
  describeOpenTask,
  describeRemoval,
  describeScheduleSummary,
  removeSchedule,
  resolveAutomationType,
  resolveScheduleStatus,
  resolveScheduleTaskId,
  updateScheduleEnabled,
} from '@/lib/schedules.ts';
import { navigate, resolveAutomationPath, resolveTaskPath, resolveTaskTarget } from '@/router.ts';
import { SETTING_ROW, SettingsBlock, SettingsEmpty, SettingsGroup } from './group.tsx';

export interface ScheduleActions {
  enable: (schedule: Schedule, enabled: boolean) => Promise<unknown>;
  copyWebhook: (schedule: Schedule) => Promise<unknown>;
  open: (schedule: Schedule) => void;
  remove: (schedule: Schedule) => Promise<unknown>;
}

export function ScheduleMenu({
  schedule,
  actions,
  showOpen = true,
}: {
  schedule: Schedule;
  actions: ScheduleActions;
  showOpen?: boolean;
}) {
  const removing = useDialogState<'remove'>();
  const canOpen = showOpen && (schedule.source !== null || resolveScheduleTaskId(schedule) !== null);
  const removal = describeRemoval(schedule);
  return (
    <>
      <DropdownMenu>
        <OptionsTrigger label='Automation options' />
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
            {canOpen && (
              <DropdownMenuItem icon='IconArrowUpRight' onClick={() => actions.open(schedule)}>
                {describeOpenTask(schedule)}
              </DropdownMenuItem>
            )}
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem icon='IconTrashCan' variant='destructive' onClick={() => removing.show('remove')}>
            Delete automation
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {removing.value && (
        <ConfirmDialog
          control={removing.control}
          title={removal.title}
          body={removal.body}
          action='Delete automation'
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
  const type = resolveAutomationType(schedule);
  const look = AUTOMATION_TYPE_LOOK[type];
  return (
    <div className={SETTING_ROW}>
      <div className='flex min-w-0 flex-1 items-center gap-2.5'>
        <StatusTile {...look} label={type} detail={look.hint} />
        <div className='flex min-w-0 flex-1 flex-col gap-px'>
          <Truncate className='text-fg-4 text-xs'>{schedule.name}</Truncate>
          <Truncate className='text-2xs text-fg-2'>{describeScheduleSummary(state, schedule)}</Truncate>
        </div>
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

export function createScheduleActions(state: ShinsaState): ScheduleActions {
  return {
    enable: updateScheduleEnabled,
    copyWebhook: copyWebhookUrl,
    open: (schedule) => {
      const taskId = resolveScheduleTaskId(schedule);
      if (schedule.source) navigate(resolveAutomationPath(schedule.id));
      else if (taskId) navigate(resolveTaskPath(resolveTaskTarget(state, taskId)));
    },
    remove: removeSchedule,
  };
}

export function ScheduleSettings({ state }: { state: ShinsaState }) {
  const schedules = listSchedules(state);
  const suggestions = listOpenWatchSuggestions(state);
  const actions = createScheduleActions(state);
  return (
    <SettingsGroup title='Automations'>
      {suggestions.length > 0 && (
        <SettingsBlock
          header={
            <>
              <Icon size='sm' name='IconLightbulbGlow' className='text-fg-2' />
              <span className='font-medium text-fg-4 text-xs'>Suggested watches</span>
            </>
          }
        >
          {suggestions.map((suggestion) => (
            <SuggestedWatchRow key={suggestion.id} state={state} suggestion={suggestion} withProject />
          ))}
        </SettingsBlock>
      )}
      {schedules.length === 0 && suggestions.length === 0 && (
        <SettingsEmpty>
          Ask an agent for a schedule, a trigger or a watch, in the home chat or any task, and it shows up
          here.
        </SettingsEmpty>
      )}
      {schedules.map((schedule) => (
        <ScheduleRow key={schedule.id} state={state} schedule={schedule} actions={actions} />
      ))}
    </SettingsGroup>
  );
}
