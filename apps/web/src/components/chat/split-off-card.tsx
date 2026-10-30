import type { ShinsaState, Task, TaskSuggestion } from '@shinsa/core';
import { cn } from '@shinsa/ui/lib/utils';
import { CardLine } from '@/components/chat/chat-line.tsx';
import { CARD } from '@/components/layout/surface/card.ts';
import { TaskLink } from '@/components/links/task.tsx';
import { SuggestionRow } from '@/components/overview/suggestions-panel.tsx';
import { InlineMarkdown } from '@/components/text/markdown.tsx';
import type { SplitOffReference } from '@/lib/chat/timeline.ts';
import { useShinsaState } from '@/lib/connection/selectors.ts';
import { describeSplitOffState } from '@/lib/tasks/messages.ts';
import { acceptSuggestion, dismissSuggestion, keepSuggestion } from '@/lib/tasks/process.ts';

function SettledSplitOff({ state, suggestion }: { state: ShinsaState; suggestion: TaskSuggestion }) {
  const created = suggestion.createdTaskId ? state.tasks[suggestion.createdTaskId] : undefined;
  return (
    <div className='flex flex-col gap-px text-xs'>
      {created ? (
        <span className='min-w-0 text-fg-4'>
          <TaskLink state={state} task={created} />
        </span>
      ) : (
        <InlineMarkdown text={suggestion.title} className='font-medium text-fg-4' />
      )}
      <InlineMarkdown text={suggestion.why} className='text-fg-3' />
    </div>
  );
}

function OpenSplitOff({ task, suggestion }: { task: Task; suggestion: TaskSuggestion }) {
  return (
    <ul className='flex flex-col'>
      <SuggestionRow
        suggestion={suggestion}
        onAccept={(chosen, start) => acceptSuggestion(task, chosen, start)}
        onDismiss={(chosen) => dismissSuggestion(task, chosen)}
        onKeep={(chosen) => keepSuggestion(task, chosen)}
      />
    </ul>
  );
}

export function SplitOffCard({ reference }: { reference: SplitOffReference }) {
  const state = useShinsaState();
  const task = state?.tasks[reference.taskId];
  const suggestion = task?.suggestions?.find((candidate) => candidate.id === reference.suggestionId);
  if (!(state && task && suggestion)) return null;
  return (
    <section
      data-split-off={suggestion.status}
      className={cn(CARD, 'mt-2 flex min-w-0 flex-col self-stretch overflow-hidden')}
    >
      <CardLine
        icon='IconLightbulbGlow'
        title='Suggested as a separate task'
        meta={describeSplitOffState(suggestion)}
      />
      <div className='flex min-w-0 flex-col gap-3 border-border border-t p-3'>
        {suggestion.status === 'open' ? (
          <OpenSplitOff task={task} suggestion={suggestion} />
        ) : (
          <SettledSplitOff state={state} suggestion={suggestion} />
        )}
      </div>
    </section>
  );
}
