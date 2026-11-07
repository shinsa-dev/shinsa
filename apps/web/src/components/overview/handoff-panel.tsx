import { isTaskSettled, resolveFirstName, type Task, type TaskEscalation } from '@shinsa/core';
import { cn } from '@shinsa/ui/lib/utils';
import { Panel } from '@/components/layout/surface/panel.tsx';
import { SMART_LINK } from '@/components/links/link.tsx';
import { useReadOnly, useReadOnlyOwner } from '@/components/task/read-only.tsx';
import { usePersonPresence } from '@/hooks/use-team-presence.ts';
import { HANDOFF_TITLE, listHandoffLines } from '@/lib/autopilot.ts';
import { useTeamFeed } from '@/lib/connection/socket.ts';
import { resolveOverviewPanelId } from '@/lib/preferences/disclosure.ts';
import { resolveSourceTaskId } from '@/lib/share/view.ts';
import { selectFeedMachine } from '@/lib/teams/presence.ts';

function HandoffLines({
  escalation,
  owner,
  ownerId,
}: {
  escalation: TaskEscalation;
  owner: string | null;
  ownerId: string | null;
}) {
  const presence = usePersonPresence(ownerId)?.status ?? null;
  const lines = listHandoffLines(escalation, { owner, presence, now: Date.now() });
  return (
    <ul className='flex list-disc flex-col gap-1.5 pl-4 text-xs text-fg-4'>
      {lines.map((line) => (
        <li key={line}>{line}</li>
      ))}
    </ul>
  );
}

function useOwnerUserId(taskId: string) {
  const feed = useTeamFeed();
  const sourceId = resolveSourceTaskId(taskId);
  const entry = feed.tasks.find((item) => item.task.id === sourceId);
  return entry ? (selectFeedMachine(feed, entry.teamId, entry.instanceId)?.userId ?? null) : null;
}

export function HandoffPanel({ task }: { task: Task }) {
  const readOnly = useReadOnly();
  const shared = useReadOnlyOwner();
  const ownerId = useOwnerUserId(task.id);
  if (!task.escalation || isTaskSettled(task)) return null;
  const user = readOnly ? (shared?.user ?? null) : null;
  const owner = readOnly ? (user ? resolveFirstName(user) : (shared?.name ?? null)) : null;
  const url = task.escalation.handoff.pullRequestUrl;
  return (
    <Panel
      persistId={resolveOverviewPanelId(task, 'handoff')}
      title={HANDOFF_TITLE[readOnly ? 'teammate' : 'owner']}
      icon='IconMegaphone'
      meta={
        url ? (
          <a
            data-smart
            href={url}
            target='_blank'
            rel='noreferrer'
            className={cn(SMART_LINK, 'text-xs font-normal')}
          >
            Open the pull request
          </a>
        ) : undefined
      }
    >
      <HandoffLines escalation={task.escalation} owner={owner} ownerId={readOnly ? ownerId : null} />
    </Panel>
  );
}
