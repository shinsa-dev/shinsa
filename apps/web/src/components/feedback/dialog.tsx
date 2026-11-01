import { FEEDBACK_REPOSITORY, type Feedback, type ShinsaState } from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import {
  Dialog,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@shinsa/ui/components/dialog';
import { Field, FieldError } from '@shinsa/ui/components/field';
import { Input } from '@shinsa/ui/components/input';
import { Spinner } from '@shinsa/ui/components/spinner';
import { Textarea } from '@shinsa/ui/components/textarea';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import { CARD, TONE_INSET } from '@/components/layout/surface/card.ts';
import { InlineMark } from '@/components/links/link.tsx';
import { TaskLink } from '@/components/links/task.tsx';
import { Markdown } from '@/components/text/markdown.tsx';
import { TimeAgo } from '@/components/text/time-ago.tsx';
import { useBusy } from '@/hooks/use-busy.ts';
import {
  canOpenFeedback,
  closeFeedbackEntry,
  describeFeedbackSource,
  describeFeedbackStatus,
  FEEDBACK_ACTIONS,
  type FeedbackActions,
  needsRedraft,
  resolveFeedbackLeaks,
  useOpenFeedbackEntryId,
  validateFeedbackIssue,
} from '@/lib/feedback.ts';
import { TONE_TEXT } from '@/lib/format/tone.ts';

function IssueEditor({
  entry,
  actions,
  onDone,
}: {
  entry: Feedback;
  actions: FeedbackActions;
  onDone: () => void;
}) {
  const [title, setTitle] = React.useState(entry.title ?? '');
  const [body, setBody] = React.useState(entry.body ?? '');
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  async function save() {
    const problem = validateFeedbackIssue(title, body);
    setError(problem);
    if (problem || busy) return;
    setBusy(true);
    const saved = await actions.update(entry, title, body);
    setBusy(false);
    if (saved) onDone();
  }

  return (
    <form
      className='flex flex-col gap-1.5'
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <Field data-invalid={error ? true : undefined}>
        <Input
          value={title}
          aria-label='Issue title'
          onChange={(event) => {
            setTitle(event.target.value);
            setError(null);
          }}
        />
        <Textarea
          rows={8}
          value={body}
          aria-label='Issue description'
          className='resize-none font-mono'
          onChange={(event) => {
            setBody(event.target.value);
            setError(null);
          }}
        />
        {error && <FieldError>{error}</FieldError>}
      </Field>
      <div className='flex items-center justify-end gap-1.5'>
        <Button type='button' variant='secondary' size='sm' onClick={onDone}>
          Cancel
        </Button>
        <Button type='submit' size='sm' loading={busy}>
          Save
        </Button>
      </div>
    </form>
  );
}

function EntrySource({ state, entry }: { state: ShinsaState; entry: Feedback }) {
  const source = describeFeedbackSource(state, entry);
  return (
    <div className='flex min-w-0 items-baseline gap-3 text-2xs text-fg-2'>
      <p className='min-w-0 flex-1 truncate'>
        <InlineMark icon={entry.source === 'agent' ? 'IconRobot' : 'IconUser'} />
        {source.label}
        {source.task && (
          <>
            {' '}
            <TaskLink state={state} task={source.task} />
          </>
        )}
      </p>
      <span className='shrink-0'>
        <TimeAgo at={entry.updatedAt} />
      </span>
    </div>
  );
}

function EntryActions({
  entry,
  leaking,
  actions,
  onEdit,
  onDone,
}: {
  entry: Feedback;
  leaking: boolean;
  actions: FeedbackActions;
  onEdit: () => void;
  onDone: () => void;
}) {
  const { busy, run } = useBusy<'dismiss' | 'file' | 'redraft'>();
  const blocked = entry.status === 'filing';
  async function finish(sent: Promise<boolean>) {
    const done = await sent;
    if (done) onDone();
    return done;
  }
  return (
    <div className='flex items-center gap-1.5'>
      <Button
        variant='secondary'
        size='sm'
        disabled={blocked || entry.status === 'drafting'}
        loading={busy === 'dismiss'}
        onClick={() => run('dismiss', () => finish(actions.dismiss(entry)))}
      >
        Dismiss
      </Button>
      <span className='flex-1' />
      {needsRedraft(entry) ? (
        <Button
          size='sm'
          icon='IconArrowRotateClockwise'
          loading={busy === 'redraft'}
          onClick={() => run('redraft', () => actions.write(entry.id, entry.note))}
        >
          Draft again
        </Button>
      ) : (
        <>
          <Button
            variant='secondary'
            size='sm'
            icon='IconPencil'
            disabled={!canOpenFeedback(entry)}
            onClick={onEdit}
          >
            Edit
          </Button>
          <Button
            size='sm'
            icon='IconArrowUpRight'
            disabled={!canOpenFeedback(entry) || leaking}
            loading={busy === 'file' || blocked}
            onClick={() => run('file', () => finish(actions.file(entry)))}
          >
            Open issue
          </Button>
        </>
      )}
    </div>
  );
}

function EntryBody({
  state,
  entry,
  actions,
  onDone,
}: {
  state: ShinsaState;
  entry: Feedback;
  actions: FeedbackActions;
  onDone: () => void;
}) {
  const [editing, setEditing] = React.useState(false);
  const status = describeFeedbackStatus(entry);
  const leaks = resolveFeedbackLeaks(state, entry);
  return (
    <div className='flex w-full flex-col gap-3 text-left' data-feedback={entry.id}>
      <EntrySource state={state} entry={entry} />
      {entry.status === 'drafting' && (
        <div className='flex items-center gap-1.5 text-fg-3 text-xs'>
          <Spinner size='sm' />
          <span>{status}</span>
        </div>
      )}
      {editing ? (
        <IssueEditor entry={entry} actions={actions} onDone={() => setEditing(false)} />
      ) : (
        entry.title !== null && (
          <div className={cn(CARD, 'flex flex-col gap-1.5 p-3')}>
            <p className='selectable font-medium text-fg-4 text-sm'>{entry.title}</p>
            {entry.body !== null && <Markdown text={entry.body} className='selectable text-fg-3 text-xs' />}
          </div>
        )
      )}
      {entry.status === 'drafting' && <p className='selectable text-fg-2 text-xs'>{entry.note}</p>}
      {entry.status === 'filing' && <p className='text-fg-3 text-xs'>{status}</p>}
      {entry.status === 'failed' && (
        <p className={cn(TONE_INSET.red, TONE_TEXT.red, 'selectable px-2.5 py-2 text-xs')}>{status}</p>
      )}
      {leaks && !editing && (
        <p className={cn(TONE_INSET.amber, TONE_TEXT.amber, 'selectable px-2.5 py-2 text-xs')}>{leaks}</p>
      )}
      {!editing && (
        <EntryActions
          entry={entry}
          leaking={leaks !== null}
          actions={actions}
          onEdit={() => setEditing(true)}
          onDone={onDone}
        />
      )}
    </div>
  );
}

export function FeedbackDialog({
  state,
  actions = FEEDBACK_ACTIONS,
}: {
  state: ShinsaState;
  actions?: FeedbackActions;
}) {
  const openId = useOpenFeedbackEntryId();
  const live = openId ? (state.feedback[openId] ?? null) : null;
  const shown = React.useRef<Feedback | null>(null);
  if (live) shown.current = live;
  const entry = live ?? shown.current;
  return (
    <Dialog
      open={live !== null}
      onOpenChange={(open) => {
        if (!open) closeFeedbackEntry();
      }}
    >
      <DialogContent>
        <DialogHeader className='px-6'>
          <DialogTitle>Review the issue</DialogTitle>
          <DialogDescription>
            It opens as a public issue on <span className='whitespace-nowrap'>{FEEDBACK_REPOSITORY}</span>{' '}
            under your GitHub account.
          </DialogDescription>
        </DialogHeader>
        <DialogCloseButton />
        {entry && (
          <EntryBody
            key={entry.id}
            state={state}
            entry={entry}
            actions={actions}
            onDone={closeFeedbackEntry}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
