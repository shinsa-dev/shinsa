import type { Initiative, ShinsaState } from '@shinsa/core';
import { Icon } from '@shinsa/ui/components/icon';
import { ListRow } from '@/components/layout/list-row.tsx';
import { Panel } from '@/components/layout/surface/panel.tsx';
import { Markdown } from '@/components/text/markdown.tsx';
import { TimeAgo } from '@/components/text/time-ago.tsx';
import { requestDraftReply } from '@/lib/chat/task-drafts.ts';
import { NO_REPORT, resolveLeadView } from '@/lib/initiatives/lead.ts';
import { createDisclosureId } from '@/lib/preferences/disclosure.ts';

export function LeadReport({ state, initiative }: { state: ShinsaState; initiative: Initiative }) {
  const view = resolveLeadView(state, initiative);
  const leadTaskId = initiative.leadTaskId;
  return (
    <Panel
      persistId={createDisclosureId('initiative', initiative.id, 'report')}
      title='Where it stands'
      icon='IconAgents'
    >
      {view.narrative === null ? (
        <p className='text-xs text-fg-2'>{NO_REPORT}</p>
      ) : (
        <Markdown text={view.narrative} className='selectable text-xs text-fg-4' />
      )}
      {view.questions.length > 0 && (
        <div className='flex flex-col gap-1'>
          <h3 className='text-2xs font-medium text-fg-3'>To discuss with you</h3>
          <div className='-mx-1.5 flex flex-col'>
            {view.questions.map((question) => (
              <ListRow
                key={question}
                leading={<Icon size='sm' name='IconBubbleQuestion' className='mt-0.5 shrink-0 text-fg-2' />}
                title={question}
                trailing='Reply'
                onClick={() => {
                  if (leadTaskId) requestDraftReply(leadTaskId, question);
                }}
              />
            ))}
          </div>
        </div>
      )}
      {view.at !== null && (
        <p className='text-2xs text-fg-2'>
          Reported <TimeAgo at={view.at} />
        </p>
      )}
    </Panel>
  );
}
