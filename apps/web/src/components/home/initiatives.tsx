import type { ShinsaState } from '@shinsa/core';
import { ListRow } from '@/components/layout/list-row.tsx';
import { WideSection } from '@/components/queue/queue.tsx';
import { StatusTile } from '@/components/status/tile.tsx';
import { TaskHandlePrefix } from '@/components/task/handle.tsx';
import { TimeAgo } from '@/components/text/time-ago.tsx';
import { resolveHomeSectionId } from '@/lib/home.ts';
import { INITIATIVE_ICON, INITIATIVES_TITLE, listInitiativeRows } from '@/lib/initiatives/view.ts';
import { navigate, resolveTaskPath } from '@/router.ts';

export function HomeInitiatives({ state }: { state: ShinsaState }) {
  const rows = listInitiativeRows(state);
  if (rows.length === 0) return null;
  return (
    <WideSection
      title={INITIATIVES_TITLE}
      count={rows.length}
      empty={null}
      persistId={resolveHomeSectionId('initiatives')}
    >
      {rows.map((row) => (
        <ListRow
          key={row.initiative.id}
          leading={<StatusTile icon={INITIATIVE_ICON} tone='neutral' />}
          title={row.initiative.name}
          meta={
            <>
              <TaskHandlePrefix task={row.lead} />
              <span className='tabular-nums'>{row.summary}</span>
            </>
          }
          trailing={
            row.initiative.report ? (
              <TimeAgo at={row.initiative.report.at} compact detail='The lead last reported' />
            ) : null
          }
          onClick={() => navigate(resolveTaskPath(row.lead))}
        />
      ))}
    </WideSection>
  );
}
