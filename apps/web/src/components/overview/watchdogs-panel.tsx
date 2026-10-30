import { isWatchdogActive, type ShinsaState, type Task, type Watchdog } from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import { Input } from '@shinsa/ui/components/input';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import { INSET } from '@/components/layout/surface/card.ts';
import { Panel } from '@/components/layout/surface/panel.tsx';
import { InfoHeader, InfoPopover } from '@/components/overlays/info-popover.tsx';
import { InlineMarkdown, Markdown } from '@/components/text/markdown.tsx';
import { useBusy } from '@/hooks/use-busy.ts';
import { TONE_TEXT } from '@/lib/format/tone.ts';
import { resolveOverviewPanelId } from '@/lib/preferences/disclosure.ts';
import {
  connectWatchdog,
  describeWatchdogMeta,
  describeWatchdogSchedule,
  describeWatchdogSummary,
  resolveWatchingReason,
  stopWatchdog,
  WATCHDOG_STATUS,
  WATCHDOGS_TITLE,
} from '@/lib/tasks/watchdogs.ts';

function SourceRequest({ task, watchdog }: { task: Task; watchdog: Watchdog }) {
  const request = watchdog.sourceRequest;
  const [server, setServer] = React.useState('');
  const [data, setData] = React.useState(request?.data ?? '');
  const { busy, run } = useBusy<'connect'>();
  if (!request) return null;
  const ready = server.trim().length > 0 && data.trim().length > 0;
  return (
    <div className={cn(INSET, 'flex flex-col gap-2.5 p-3 text-xs')}>
      <p className='text-fg-4'>
        It needs <InlineMarkdown text={request.data} className='inline' />.{' '}
        <InlineMarkdown text={request.evidence} className='inline text-fg-3' />
      </p>
      <div className='flex flex-col gap-1'>
        <span className='text-fg-3'>Servers you could connect:</span>
        <ul className='flex list-disc flex-col gap-1 pl-4 text-fg-4'>
          {request.suggestions.map((suggestion) => (
            <li key={suggestion}>
              <InlineMarkdown text={suggestion} />
            </li>
          ))}
        </ul>
      </div>
      <form
        className='flex flex-wrap items-center gap-1.5'
        onSubmit={(event) => {
          event.preventDefault();
          if (ready) void run('connect', () => connectWatchdog(task, watchdog, server, data));
        }}
      >
        <Input
          size='sm'
          aria-label='MCP server'
          placeholder='MCP server, as Integrations names it'
          value={server}
          onChange={(event) => setServer(event.target.value)}
          className='min-w-40 flex-1'
        />
        <Input
          size='sm'
          aria-label='What it holds'
          placeholder='What it holds'
          value={data}
          onChange={(event) => setData(event.target.value)}
          className='min-w-40 flex-1'
        />
        <Button type='submit' size='sm' disabled={!ready} loading={busy === 'connect'}>
          Connect
        </Button>
      </form>
      <p className='text-fg-2'>Connect the server in Settings → Integrations first, then name it here.</p>
    </div>
  );
}

function WatchdogRow({
  state,
  task,
  watchdog,
  now,
}: {
  state: ShinsaState;
  task: Task;
  watchdog: Watchdog;
  now: number;
}) {
  const { busy, run } = useBusy<'stop'>();
  const status = WATCHDOG_STATUS[watchdog.status];
  const active = isWatchdogActive(watchdog);
  const meta = describeWatchdogMeta(watchdog, now);
  return (
    <li className='flex flex-col gap-2 py-2.5 first:pt-0 last:pb-0'>
      <div className='flex items-start gap-3'>
        <div className='flex min-w-0 flex-1 flex-col gap-px text-xs'>
          <div className='flex min-w-0 items-baseline gap-2'>
            <span className='min-w-0 truncate font-medium text-fg-4 leading-5'>{watchdog.title}</span>
            <InfoPopover
              render={
                <button
                  type='button'
                  className={cn('shrink-0 cursor-default text-left outline-none', TONE_TEXT[status.tone])}
                />
              }
              trigger={status.label}
              className='w-80'
            >
              <InfoHeader
                title={<Markdown text={watchdog.check} className='text-fg-4 text-xs' />}
                description={`${describeWatchdogSchedule(watchdog)}${watchdog.source ? ` · ${watchdog.source.server}` : ''}`}
              />
            </InfoPopover>
            {meta && <span className='shrink-0 text-fg-2 tabular-nums'>{meta}</span>}
          </div>
          <Markdown text={describeWatchdogSummary(state, watchdog, now)} className='text-fg-3 text-xs' />
        </div>
        {active && (
          <Button
            variant='secondary'
            size='sm'
            loading={busy === 'stop'}
            onClick={() => void run('stop', () => stopWatchdog(task, watchdog))}
          >
            Stop
          </Button>
        )}
      </div>
      {watchdog.status === 'needs_source' && <SourceRequest task={task} watchdog={watchdog} />}
    </li>
  );
}

export function WatchdogsPanel({
  state,
  task,
  now = Date.now(),
}: {
  state: ShinsaState;
  task: Task;
  now?: number;
}) {
  const watchdogs = task.watchdogs ?? [];
  if (watchdogs.length === 0) return null;
  const watching = resolveWatchingReason(task, now);
  return (
    <Panel persistId={resolveOverviewPanelId(task, 'watchdogs')} title={WATCHDOGS_TITLE} icon='IconRadar'>
      <p className='text-fg-3 text-xs'>
        {watching ? `${watching}. ` : ''}Once the change is live, each watchdog checks it soon and then less
        often as it holds up. An issue it finds becomes a new task that starts from this task’s conversation.
      </p>
      <ul className='flex flex-col divide-y divide-border'>
        {watchdogs.map((watchdog) => (
          <WatchdogRow key={watchdog.id} state={state} task={task} watchdog={watchdog} now={now} />
        ))}
      </ul>
    </Panel>
  );
}
