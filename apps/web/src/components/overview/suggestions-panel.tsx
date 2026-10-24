import type { Task, TaskSuggestion } from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import * as React from 'react';
import { SelectField } from '@/components/controls/select-field.tsx';
import { Panel } from '@/components/layout/surface/panel.tsx';
import { InlineMarkdown } from '@/components/text/markdown.tsx';
import { useBusy } from '@/hooks/use-busy.ts';
import { acceptSuggestion, dismissSuggestion, keepSuggestion } from '@/lib/tasks/process.ts';
import {
  listOpenSuggestions,
  listSuggestionStarts,
  resolveSuggestionStart,
  SUGGESTION_START_LABEL,
  type SuggestionStart,
} from '@/lib/tasks/suggestions.ts';

type SuggestionAccepter = (suggestion: TaskSuggestion, start: SuggestionStart) => Promise<boolean>;

type SuggestionDismisser = (suggestion: TaskSuggestion) => Promise<boolean>;

type SuggestionKeeper = (suggestion: TaskSuggestion) => Promise<boolean>;

function SuggestionRow({
  suggestion,
  onAccept,
  onDismiss,
  onKeep,
}: {
  suggestion: TaskSuggestion;
  onAccept: SuggestionAccepter;
  onDismiss: SuggestionDismisser;
  onKeep: SuggestionKeeper;
}) {
  const { busy, run } = useBusy<'accept' | 'dismiss' | 'keep'>();
  const [start, setStart] = React.useState<SuggestionStart>(resolveSuggestionStart(suggestion));

  return (
    <li className='flex items-start gap-3 py-2 first:pt-0 last:pb-0'>
      <div className='flex min-w-0 flex-1 flex-col gap-px text-xs'>
        <InlineMarkdown text={suggestion.title} className='font-medium text-fg-4 leading-5' />
        <InlineMarkdown text={suggestion.why} className='text-fg-3' />
      </div>
      <div className='flex shrink-0 items-center gap-1.5'>
        <SelectField
          label={SUGGESTION_START_LABEL}
          size='sm'
          variant='ghost'
          items={listSuggestionStarts(suggestion)}
          value={start}
          onValueChange={setStart}
        />
        {suggestion.splitOff ? (
          <Button
            variant='secondary'
            size='sm'
            loading={busy === 'keep'}
            onClick={() => void run('keep', () => onKeep(suggestion))}
          >
            Keep it here
          </Button>
        ) : (
          <Button
            variant='secondary'
            size='sm'
            loading={busy === 'dismiss'}
            onClick={() => void run('dismiss', () => onDismiss(suggestion))}
          >
            Dismiss
          </Button>
        )}
        <Button
          variant='outline'
          size='sm'
          loading={busy === 'accept'}
          onClick={() => void run('accept', () => onAccept(suggestion, start))}
        >
          {suggestion.splitOff ? 'Make it a task' : 'Add'}
        </Button>
      </div>
    </li>
  );
}

export function SuggestionsPanel({
  task,
  onAccept = (suggestion, start) => acceptSuggestion(task, suggestion, start),
  onDismiss = (suggestion) => dismissSuggestion(task, suggestion),
  onKeep = (suggestion) => keepSuggestion(task, suggestion),
}: {
  task: Task;
  onAccept?: SuggestionAccepter;
  onDismiss?: SuggestionDismisser;
  onKeep?: SuggestionKeeper;
}) {
  const open = listOpenSuggestions(task);
  if (open.length === 0) return null;
  return (
    <Panel title='Suggested tasks' icon='IconLightbulbGlow'>
      <ul className='flex flex-col divide-y divide-border'>
        {open.map((suggestion) => (
          <SuggestionRow
            key={suggestion.id}
            suggestion={suggestion}
            onAccept={onAccept}
            onDismiss={onDismiss}
            onKeep={onKeep}
          />
        ))}
      </ul>
    </Panel>
  );
}
