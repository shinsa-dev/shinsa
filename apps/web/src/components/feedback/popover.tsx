import { FEEDBACK_REPOSITORY, type Feedback, type ShinsaState } from '@shinsa/core';
import { Badge } from '@shinsa/ui/components/badge';
import { Button } from '@shinsa/ui/components/button';
import { Field, FieldError } from '@shinsa/ui/components/field';
import { Icon } from '@shinsa/ui/components/icon';
import { Spinner } from '@shinsa/ui/components/spinner';
import { Truncate } from '@shinsa/ui/components/truncate';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import { CompactSection, CompactSections } from '@/components/layout/compact-section.tsx';
import { LIST_ROW, LIST_ROW_LINES, LIST_ROW_META, LIST_ROW_TITLE } from '@/components/layout/list-row.tsx';
import { ICON_SLOT } from '@/components/layout/surface/card.ts';
import { Hint } from '@/components/overlays/hint.tsx';
import { TimeAgo } from '@/components/text/time-ago.tsx';
import {
  describeFeedbackFiled,
  describeFeedbackIssue,
  describeFeedbackPreview,
  describeFeedbackRowMeta,
  describeFeedbackSender,
  FEEDBACK_AGENTS_NOTE,
  FEEDBACK_HINT,
  FEEDBACK_ICON,
  FEEDBACK_INTRO,
  type FeedbackActions,
  isFeedbackClosed,
  listFeedbackGroups,
  openFeedbackEntry,
  resolveFeedbackFiledAt,
  resolveFeedbackRowIcon,
  resolveFeedbackSectionId,
  validateFeedbackNote,
} from '@/lib/feedback.ts';
import { TONE_TEXT } from '@/lib/format/tone.ts';
import { isSubmitKey } from '@/lib/keys.ts';

export const FEEDBACK_POPOVER =
  'flex max-h-(--available-height) w-96 max-w-[calc(100vw-1rem)] flex-col gap-0 p-0';

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
      className='flex flex-col gap-1'
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
    >
      <Field data-invalid={error ? true : undefined}>
        <div
          data-invalid={error ? true : undefined}
          className='corner-superellipse/1.125 flex flex-col rounded-lg bg-input backdrop-blur-md data-[invalid]:ring-1 data-[invalid]:ring-red-4'
        >
          <textarea
            rows={2}
            value={note}
            aria-label='Your feedback'
            aria-invalid={error ? true : undefined}
            placeholder='What got in your way, or what you wish Shinsa did'
            className='field-sizing-content max-h-40 min-h-12 w-full resize-none bg-transparent px-2.5 pt-1.5 text-fg-4 text-xs outline-none placeholder:text-fg-2'
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
          <div className='flex items-center justify-end p-1'>
            <Hint label={FEEDBACK_HINT}>
              <Button
                type='submit'
                size='icon-sm'
                variant={note.trim() || busy ? 'primary' : 'secondary'}
                aria-label='Draft issue'
                disabled={!note.trim()}
                loading={busy}
              >
                {!busy && <Icon name='IconArrowUp' />}
              </Button>
            </Hint>
          </div>
        </div>
        {error && <FieldError>{error}</FieldError>}
      </Field>
    </form>
  );
}

function RowIcon({ state, entry }: { state: ShinsaState; entry: Feedback }) {
  const glyph = resolveFeedbackRowIcon(state, entry);
  return (
    <span
      className={cn(
        ICON_SLOT,
        '-mt-px',
        glyph.kind === 'icon' && glyph.tone !== 'neutral' ? TONE_TEXT[glyph.tone] : 'text-fg-3'
      )}
    >
      {glyph.kind === 'busy' ? <Spinner size='sm' /> : <Icon size='sm' name={glyph.icon} />}
    </span>
  );
}

function WaitingRow({
  state,
  entry,
  onOpen,
}: {
  state: ShinsaState;
  entry: Feedback;
  onOpen: (entry: Feedback) => void;
}) {
  const preview = describeFeedbackPreview(entry);
  return (
    <button
      type='button'
      data-highlight-item=''
      data-feedback={entry.id}
      aria-label={`Open feedback: ${preview}`}
      onClick={() => onOpen(entry)}
      className={cn(LIST_ROW, LIST_ROW_LINES, 'px-1.5')}
    >
      <RowIcon state={state} entry={entry} />
      <span className='flex min-w-0 flex-1 flex-col gap-px'>
        <Truncate className={LIST_ROW_TITLE}>{preview}</Truncate>
        <Truncate className={LIST_ROW_META}>{describeFeedbackRowMeta(state, entry)}</Truncate>
      </span>
      <span className={cn(LIST_ROW_META, 'shrink-0 leading-5')}>
        <TimeAgo at={entry.updatedAt} />
      </span>
    </button>
  );
}

function FiledRow({ state, entry }: { state: ShinsaState; entry: Feedback }) {
  const closed = isFeedbackClosed(entry);
  return (
    <a
      href={entry.issue?.url}
      target='_blank'
      rel='noreferrer'
      data-highlight-item=''
      data-feedback={entry.id}
      className={cn(LIST_ROW, LIST_ROW_LINES, 'group/issue px-1.5')}
    >
      <RowIcon state={state} entry={entry} />
      <span className='flex min-w-0 flex-1 flex-col gap-px'>
        <Truncate className={cn(LIST_ROW_TITLE, closed && 'text-fg-3')}>{entry.title}</Truncate>
        <span className={cn(LIST_ROW_META, 'truncate')}>
          <span className='sr-only'>{describeFeedbackSender(entry)}, </span>
          <span className='tabular-nums'>{describeFeedbackIssue(entry)}</span>
          {' · '}
          <TimeAgo at={resolveFeedbackFiledAt(entry)} text={(now) => describeFeedbackFiled(entry, now)} />
        </span>
      </span>
      {closed && (
        <Badge size='sm' className='shrink-0'>
          Closed
        </Badge>
      )}
      <span className='grid size-5 shrink-0 place-items-center text-fg-2 opacity-0 group-hover/issue:opacity-100 group-active/issue:opacity-100'>
        <Icon size='sm' name='IconArrowUpRight' />
      </span>
    </a>
  );
}

export function FeedbackPanel({
  state,
  actions,
  onOpen = (entry) => openFeedbackEntry(entry.id),
}: {
  state: ShinsaState;
  actions: FeedbackActions;
  onOpen?: (entry: Feedback) => void;
}) {
  const groups = listFeedbackGroups(state);
  return (
    <>
      <div className='flex shrink-0 flex-col gap-2 border-border border-b p-3'>
        <div className='flex flex-col gap-px'>
          <p className='font-medium text-fg-4 text-xs'>Feedback on Shinsa</p>
          <p className='text-2xs text-fg-2'>
            {FEEDBACK_INTRO.before} <span className='whitespace-nowrap'>{FEEDBACK_REPOSITORY}</span>
            {FEEDBACK_INTRO.after}
          </p>
        </div>
        <NoteForm actions={actions} />
      </div>
      <div className='min-h-0 overflow-y-auto'>
        <CompactSections className='pt-1.5'>
          <CompactSection
            persistId={resolveFeedbackSectionId('waiting')}
            leading={<Icon size='sm' name={FEEDBACK_ICON} />}
            title='Waiting for you'
            count={groups.waiting.length > 0 ? groups.waiting.length : null}
          >
            {groups.waiting.length === 0 ? (
              <p className='px-1.5 pt-0.5 pb-1.5 text-2xs text-fg-2'>{FEEDBACK_AGENTS_NOTE}</p>
            ) : (
              groups.waiting.map((entry) => (
                <WaitingRow key={entry.id} state={state} entry={entry} onOpen={onOpen} />
              ))
            )}
          </CompactSection>
          {groups.filed.length > 0 && (
            <CompactSection
              persistId={resolveFeedbackSectionId('filed')}
              leading={<Icon size='sm' name='IconGithub' />}
              title='Opened on GitHub'
              count={groups.filed.length}
            >
              {groups.filed.map((entry) => (
                <FiledRow key={entry.id} state={state} entry={entry} />
              ))}
            </CompactSection>
          )}
        </CompactSections>
      </div>
    </>
  );
}
