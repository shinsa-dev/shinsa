import type { Initiative, ShinsaState } from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@shinsa/ui/components/dialog';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@shinsa/ui/components/field';
import { Icon } from '@shinsa/ui/components/icon';
import { useDialogState } from '@shinsa/ui/hooks/use-dialog-state';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import { SelectField } from '@/components/controls/select-field.tsx';
import { CARD, CARD_FOOTER, CARD_HEADER } from '@/components/layout/surface/card.ts';
import { TaskLink } from '@/components/links/task.tsx';
import { Markdown } from '@/components/text/markdown.tsx';
import { TimeAgo } from '@/components/text/time-ago.tsx';
import { useEngineCommand } from '@/lib/connection/socket.ts';
import {
  FRESH_LEAD,
  type LeadView,
  listLeadSources,
  NO_LEAD,
  NO_REPORT,
  selectLeadView,
  START_LEAD,
  startLead,
} from '@/lib/initiatives/lead.ts';
import { navigate, resolveTaskPath } from '@/router.ts';

function StartLeadForm({
  state,
  initiative,
  onDone,
}: {
  state: ShinsaState;
  initiative: Initiative;
  onDone: () => void;
}) {
  const [source, setSource] = React.useState(FRESH_LEAD);
  const [busy, setBusy] = React.useState(false);
  const items = listLeadSources(state, initiative);
  async function submit() {
    setBusy(true);
    const started = await startLead(initiative, source);
    setBusy(false);
    if (started) onDone();
  }
  return (
    <>
      <DialogHeader>
        <DialogTitle>{START_LEAD.title}</DialogTitle>
        <DialogDescription>{START_LEAD.description}</DialogDescription>
      </DialogHeader>
      <FieldGroup>
        <Field>
          <FieldLabel>{START_LEAD.sourceLabel}</FieldLabel>
          <SelectField
            label={START_LEAD.sourceLabel}
            items={items}
            value={source}
            onValueChange={setSource}
            align='start'
            className='w-full max-w-full'
          />
          <FieldDescription>{START_LEAD.sourceHint}</FieldDescription>
        </Field>
      </FieldGroup>
      <DialogFooter>
        <DialogClose render={<Button variant='secondary' />}>Cancel</DialogClose>
        <Button loading={busy} onClick={() => void submit()}>
          {START_LEAD.submit}
        </Button>
      </DialogFooter>
    </>
  );
}

function NoLead({ state, initiative }: { state: ShinsaState; initiative: Initiative }) {
  const canStart = useEngineCommand('initiative.start_lead');
  const dialog = useDialogState<true>();
  return (
    <section className={cn(CARD, 'flex items-start gap-3 px-3 py-3')}>
      <Icon name='IconAgents' className='mt-0.5 shrink-0 text-fg-2' />
      <div className='flex min-w-0 flex-1 flex-col'>
        <h2 className='text-xs font-medium text-fg-4'>{NO_LEAD.title}</h2>
        <p className='text-xs text-fg-2'>{NO_LEAD.body}</p>
      </div>
      {canStart && (
        <Button size='sm' variant='secondary' className='shrink-0' onClick={() => dialog.show(true)}>
          {START_LEAD.title}
        </Button>
      )}
      <Dialog {...dialog.control}>
        <DialogContent>
          {dialog.value && <StartLeadForm state={state} initiative={initiative} onDone={dialog.close} />}
        </DialogContent>
      </Dialog>
    </section>
  );
}

function LeadReport({ view }: { view: LeadView }) {
  if (view.narrative === null) return <p className='px-3 py-3 text-xs text-fg-2'>{NO_REPORT}</p>;
  return (
    <div className='flex flex-col gap-3 px-3 py-3'>
      <div className='selectable text-xs text-fg-4'>
        <Markdown text={view.narrative} />
      </div>
      {view.questions.length > 0 && (
        <div className='flex flex-col gap-1.5'>
          <h3 className='text-2xs font-medium text-fg-3'>Anything to discuss</h3>
          <ul className='flex flex-col gap-1'>
            {view.questions.map((question) => (
              <li key={question} className='flex selectable gap-2 text-xs text-fg-4'>
                <Icon size='sm' name='IconBubbleQuestion' className='mt-0.5 shrink-0 text-fg-2' />
                <span className='min-w-0'>{question}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function LeadPanel({ state, initiative }: { state: ShinsaState; initiative: Initiative }) {
  const view = selectLeadView(state, initiative);
  if (!view) return <NoLead state={state} initiative={initiative} />;
  return (
    <section aria-label='From the lead' className={cn(CARD, 'flex flex-col overflow-hidden')}>
      <div className={cn(CARD_HEADER, 'border-b border-border')}>
        <Icon size='sm' name='IconAgents' className='text-fg-2' />
        <span>From the lead</span>
        {view.at !== null && (
          <span className='ms-auto text-2xs font-normal text-fg-2'>
            <TimeAgo at={view.at} />
          </span>
        )}
      </div>
      <LeadReport view={view} />
      <div className={cn(CARD_FOOTER, 'flex items-center justify-between gap-3 py-2')}>
        <span className='min-w-0 truncate text-xs'>
          <TaskLink state={state} task={view.lead} />
        </span>
        <Button
          size='sm'
          variant='outline'
          icon='IconBubbleText'
          className='shrink-0'
          onClick={() => navigate(resolveTaskPath(view.lead))}
        >
          Open the chat
        </Button>
      </div>
    </section>
  );
}
