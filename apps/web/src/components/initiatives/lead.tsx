import type { Initiative, ShinsaState } from '@shinsa/core';
import { Icon } from '@shinsa/ui/components/icon';
import { Panel } from '@/components/layout/surface/panel.tsx';
import { Markdown } from '@/components/text/markdown.tsx';
import { TimeAgo } from '@/components/text/time-ago.tsx';
import { NO_REPORT, resolveLeadView } from '@/lib/initiatives/lead.ts';
import { createDisclosureId } from '@/lib/preferences/disclosure.ts';

export function LeadReport({ state, initiative }: { state: ShinsaState; initiative: Initiative }) {
  const view = resolveLeadView(state, initiative);
  return (
    <Panel
      persistId={createDisclosureId('initiative', initiative.id, 'report')}
      title='Where it stands'
      icon='IconAgents'
      meta={
        view.at === null ? undefined : (
          <span className='text-2xs font-normal text-fg-2'>
            <TimeAgo at={view.at} />
          </span>
        )
      }
    >
      {view.narrative === null ? (
        <p className='text-xs text-fg-2'>{NO_REPORT}</p>
      ) : (
        <Markdown text={view.narrative} className='selectable text-xs text-fg-4' />
      )}
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
    </Panel>
  );
}
