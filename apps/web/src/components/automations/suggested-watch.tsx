import type { ShinsaState, WatchSuggestion } from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import { Icon } from '@shinsa/ui/components/icon';
import { Truncate } from '@shinsa/ui/components/truncate';
import { cn } from '@shinsa/ui/lib/utils';
import { Hint } from '@/components/overlays/hint.tsx';
import { SETTING_ROW } from '@/components/settings/group.tsx';
import { StatusTile } from '@/components/status/tile.tsx';
import { useBusy } from '@/hooks/use-busy.ts';
import { AUTOMATION_TYPE_LOOK } from '@/lib/schedules.ts';
import {
  describeSuggestionDetail,
  resolveSuggestionProject,
  WATCH_SUGGESTION_ACTIONS,
  type WatchSuggestionActions,
} from '@/lib/watch-suggestions.ts';

const SUGGESTED_HINT = 'A suggested watch. Nothing reads the integration until you add it.';

export function SuggestedWatchButtons({
  suggestion,
  primary = false,
  actions = WATCH_SUGGESTION_ACTIONS,
}: {
  suggestion: WatchSuggestion;
  primary?: boolean;
  actions?: WatchSuggestionActions;
}) {
  const { busy, run } = useBusy<'accept' | 'dismiss'>();
  return (
    <div className='flex shrink-0 items-center gap-1'>
      <Button
        variant={primary ? 'primary' : 'secondary'}
        size='sm'
        loading={busy === 'accept'}
        disabled={busy !== null}
        onClick={() => void run('accept', () => actions.accept(suggestion))}
      >
        Add the watch
      </Button>
      {primary ? (
        <Button
          variant='secondary'
          size='sm'
          loading={busy === 'dismiss'}
          disabled={busy !== null}
          onClick={() => void run('dismiss', () => actions.dismiss(suggestion))}
        >
          Cancel
        </Button>
      ) : (
        <Hint label='Dismiss the suggested watch'>
          <Button
            variant='secondary'
            size='icon-sm'
            icon='IconCrossSmall'
            aria-label='Dismiss the suggested watch'
            disabled={busy !== null}
            onClick={() => void run('dismiss', () => actions.dismiss(suggestion))}
          />
        </Hint>
      )}
    </div>
  );
}

export function SuggestedSourceWatchRow({
  suggestion,
  actions,
}: {
  suggestion: WatchSuggestion;
  actions?: WatchSuggestionActions;
}) {
  return (
    <div className={cn(SETTING_ROW, 'gap-2')}>
      <Hint label={SUGGESTED_HINT}>
        <span className='grid size-3.5 shrink-0 place-items-center'>
          <Icon size='sm' name='IconLightbulbGlow' />
        </span>
      </Hint>
      <span className='flex min-w-0 flex-1 items-baseline gap-1.5'>
        <Truncate className='min-w-0 text-fg-4 text-xs'>{suggestion.text}</Truncate>
        <Truncate className='min-w-0 shrink-[2] text-2xs text-fg-2'>
          {describeSuggestionDetail(suggestion, null)}
        </Truncate>
      </span>
      <SuggestedWatchButtons suggestion={suggestion} {...(actions ? { actions } : {})} />
    </div>
  );
}

export function SuggestedWatchRow({
  state,
  suggestion,
  withProject,
  actions,
}: {
  state: ShinsaState;
  suggestion: WatchSuggestion;
  withProject: boolean;
  actions?: WatchSuggestionActions;
}) {
  const look = AUTOMATION_TYPE_LOOK.Watch;
  return (
    <div className={cn(SETTING_ROW, 'gap-2')}>
      <div className='flex min-w-0 flex-1 items-center gap-2.5'>
        <StatusTile
          icon='IconLightbulbGlow'
          tone={look.tone}
          label='Suggested watch'
          detail={SUGGESTED_HINT}
        />
        <div className='flex min-w-0 flex-1 flex-col'>
          <span className='selectable text-fg-4 text-xs'>{suggestion.text}</span>
          <Truncate className='text-2xs text-fg-2'>
            {describeSuggestionDetail(
              suggestion,
              withProject ? resolveSuggestionProject(state, suggestion) : null
            )}
          </Truncate>
        </div>
      </div>
      <SuggestedWatchButtons suggestion={suggestion} {...(actions ? { actions } : {})} />
    </div>
  );
}
