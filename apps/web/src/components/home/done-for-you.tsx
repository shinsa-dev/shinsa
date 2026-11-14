import type { ShinsaState } from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import { ListRow } from '@/components/layout/list-row.tsx';
import { WideSection } from '@/components/queue/queue.tsx';
import { StatusTile } from '@/components/status/tile.tsx';
import { TimeAgo } from '@/components/text/time-ago.tsx';
import { DONE_FOR_YOU_ALL_SEEN, DONE_FOR_YOU_TITLE, listDoneForYouRows } from '@/lib/autopilot.ts';
import { sendCommandWithToast } from '@/lib/connection/commands.ts';
import { useEngineCommand } from '@/lib/connection/socket.ts';
import { resolveHomeSectionId } from '@/lib/home.ts';
import { navigate, resolveTaskPath, resolveTaskTarget } from '@/router.ts';

function markSeen(gateIds: string[]) {
  void sendCommandWithToast({ type: 'autopilot.seen', gateIds });
}

export function DoneForYou({ state }: { state: ShinsaState }) {
  const supported = useEngineCommand('autopilot.seen');
  const rows = listDoneForYouRows(state);
  if (!supported || rows.length === 0) return null;
  return (
    <WideSection
      title={DONE_FOR_YOU_TITLE}
      count={rows.length}
      empty={null}
      persistId={resolveHomeSectionId('done')}
      action={
        rows.length > 1 && (
          <Button variant='secondary' size='xs' onClick={() => markSeen(rows.map((row) => row.gateId))}>
            {DONE_FOR_YOU_ALL_SEEN}
          </Button>
        )
      }
    >
      {rows.map((row) => (
        <ListRow
          key={row.gateId}
          holdsLinks
          taskId={row.taskId}
          leading={<StatusTile icon={row.icon} tone={row.tone} />}
          title={row.title}
          meta={`${row.summary} ${row.reason}`}
          trailing={<TimeAgo at={row.at} compact />}
          onClick={() => {
            markSeen([row.gateId]);
            navigate(resolveTaskPath(resolveTaskTarget(state, row.taskId)));
          }}
        />
      ))}
    </WideSection>
  );
}
