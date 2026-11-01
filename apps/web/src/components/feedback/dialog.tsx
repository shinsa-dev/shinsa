import type { Feedback, ShinsaState } from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import {
  Dialog,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@shinsa/ui/components/dialog';
import { EmptyState } from '@shinsa/ui/components/empty-state';
import { Field, FieldError } from '@shinsa/ui/components/field';
import { Icon } from '@shinsa/ui/components/icon';
import { Input } from '@shinsa/ui/components/input';
import { Spinner } from '@shinsa/ui/components/spinner';
import { Textarea } from '@shinsa/ui/components/textarea';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import { CARD, TONE_INSET } from '@/components/layout/surface/card.ts';
import { TaskLink } from '@/components/links/task.tsx';
import { CheckMark } from '@/components/status/check-mark.tsx';
import { Markdown } from '@/components/text/markdown.tsx';
import { TimeAgo } from '@/components/text/time-ago.tsx';
import { useBusy } from '@/hooks/use-busy.ts';
import {
  canOpenFeedback,
  describeFeedbackIssue,
  describeFeedbackSource,
  describeFeedbackStatus,
  FEEDBACK_ACTIONS,
  FEEDBACK_AGENTS_NOTE,
  FEEDBACK_ICON,
  FEEDBACK_INTRO,
  type FeedbackActions,
  listFeedbackGroups,
  needsRedraft,
  resolveFeedbackLeaks,
  updateFeedbackOpen,
  useFeedbackOpen,
  validateFeedbackIssue,
  validateFeedbackNote,
} from '@/lib/feedback.ts';
import { TONE_TEXT } from '@/lib/format/tone.ts';
import { isSubmitKey } from '@/lib/keys.ts';

const SECTION = 'flex flex-col gap-2';

const SECTION_HEADING = 'font-medium text-2xs text-fg-2';

function NoteForm({ actions }: { actions: FeedbackActions }) {
  const [note, setNote] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  async function send() {
    const problem = validateFeedbackNote(note);
    setError(problem);
    if (problem || busy) return;
    setBusy(true);
    const sent = await actions.write(null, note);
    setBusy(false);
    if (sent) setNote('');
  }

  return (
    <form
      className='flex flex-col gap-1.5'
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
    >
      <Field data-invalid={error ? true : undefined}>
        <Textarea
          rows={4}
          value={note}
          aria-label='Your feedback'
          aria-invalid={error ? true : undefined}
          placeholder='What got in your way, or what you wish Shinsa did'
          className='resize-none'
          onKeyDown={(event) => {
            if (isSubmitKey(event)) {
              event.preventDefault();
              void send();
            }
          }}
          onChange={(event) => {
            setNote(event.target.value);
            setError(null);
          }}
        />
        {error && <FieldError>{error}</FieldError>}
      </Field>
      <div className='flex items-center justify-end'>
        <Button type='submit' size='sm' disabled={!note.trim()} loading={busy}>
          Draft issue
        </Button>
      </div>
    </form>
  );
}

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
    <div className='flex min-w-0 items-center gap-1 text-2xs text-fg-2'>
      <Icon size='sm' name={entry.source === 'agent' ? 'IconRobot' : 'IconUser'} />
      <span className='shrink-0'>{source.label}</span>
      {source.task && (
        <span className='min-w-0 truncate'>
          <TaskLink state={state} task={source.task} />
        </span>
      )}
      <span className='ms-auto shrink-0'>
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
}: {
  entry: Feedback;
  leaking: boolean;
  actions: FeedbackActions;
  onEdit: () => void;
}) {
  const { busy, run } = useBusy<'dismiss' | 'file' | 'redraft'>();
  const blocked = entry.status === 'filing';
  return (
    <div className='flex items-center gap-1.5'>
      <Button
        variant='secondary'
        size='sm'
        disabled={blocked || entry.status === 'drafting'}
        loading={busy === 'dismiss'}
        onClick={() => run('dismiss', () => actions.dismiss(entry))}
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
            onClick={() => run('file', () => actions.file(entry))}
          >
            Open issue
          </Button>
        </>
      )}
    </div>
  );
}

function WaitingEntry({
  state,
  entry,
  actions,
}: {
  state: ShinsaState;
  entry: Feedback;
  actions: FeedbackActions;
}) {
  const [editing, setEditing] = React.useState(false);
  const status = describeFeedbackStatus(entry);
  const leaks = entry.title !== null && entry.body !== null ? resolveFeedbackLeaks(state, entry) : null;
  return (
    <div className={cn(CARD, 'flex flex-col gap-2 p-3')} data-feedback={entry.id}>
      <EntrySource state={state} entry={entry} />
      {entry.status === 'drafting' ? (
        <div className='flex items-center gap-1.5 text-fg-3 text-xs'>
          <Spinner size='sm' />
          <span>{status}</span>
        </div>
      ) : null}
      {editing ? (
        <IssueEditor entry={entry} actions={actions} onDone={() => setEditing(false)} />
      ) : (
        entry.title !== null && (
          <div className='flex flex-col gap-1'>
            <p className='selectable font-medium text-fg-4 text-sm'>{entry.title}</p>
            {entry.body !== null && <Markdown text={entry.body} className='selectable text-fg-3 text-xs' />}
          </div>
        )
      )}
      {entry.status === 'drafting' && (
        <p className='selectable line-clamp-3 text-fg-2 text-xs'>{entry.note}</p>
      )}
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
        />
      )}
    </div>
  );
}

function FiledEntry({ entry }: { entry: Feedback }) {
  return (
    <a
      href={entry.issue?.url}
      target='_blank'
      rel='noreferrer'
      className='flex min-w-0 items-center gap-2 rounded-control px-1.5 py-1 text-xs hover:bg-bg-a1 active:bg-bg-a1'
    >
      <CheckMark />
      <span className='min-w-0 flex-1 truncate text-fg-4'>{entry.title}</span>
      <span className='shrink-0 text-fg-2 tabular-nums'>{describeFeedbackIssue(entry)}</span>
    </a>
  );
}

export function FeedbackPanel({ state, actions }: { state: ShinsaState; actions: FeedbackActions }) {
  const groups = listFeedbackGroups(state);
  return (
    <div className='flex flex-col gap-5'>
      <NoteForm actions={actions} />
      <section className={SECTION}>
        <h3 className={SECTION_HEADING}>Waiting for you</h3>
        {groups.waiting.length === 0 ? (
          <EmptyState
            icon={FEEDBACK_ICON}
            size='sm'
            title='Nothing waits for you'
            description={FEEDBACK_AGENTS_NOTE}
          />
        ) : (
          groups.waiting.map((entry) => (
            <WaitingEntry key={entry.id} state={state} entry={entry} actions={actions} />
          ))
        )}
      </section>
      {groups.filed.length > 0 && (
        <section className={SECTION}>
          <h3 className={SECTION_HEADING}>Opened on GitHub</h3>
          <div className='flex flex-col gap-px'>
            {groups.filed.map((entry) => (
              <FiledEntry key={entry.id} entry={entry} />
            ))}
          </div>
        </section>
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
  const open = useFeedbackOpen();
  return (
    <Dialog open={open} onOpenChange={updateFeedbackOpen}>
      <DialogContent>
        <DialogHeader className='px-6'>
          <DialogTitle>Feedback on Shinsa</DialogTitle>
          <DialogDescription>{FEEDBACK_INTRO}</DialogDescription>
        </DialogHeader>
        <DialogCloseButton />
        <div className='w-full'>
          <FeedbackPanel state={state} actions={actions} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
