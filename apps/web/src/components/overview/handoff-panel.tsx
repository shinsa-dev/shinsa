import { isTaskSettled, resolveFirstName, type Task, type TaskEscalation } from '@shinsa/core';
import { Panel } from '@/components/layout/surface/panel.tsx';
import { useReadOnly, useReadOnlyOwner } from '@/components/task/read-only.tsx';
import { usePersonPresence } from '@/hooks/use-team-presence.ts';
import { HANDOFF_TITLE, listHandoffParagraphs } from '@/lib/autopilot.ts';
import { useTeamFeed } from '@/lib/connection/socket.ts';
import { resolveOverviewPanelId } from '@/lib/preferences/disclosure.ts';
import { resolveSourceTaskId } from '@/lib/share/view.ts';
import { selectFeedMachine } from '@/lib/teams/presence.ts';

function HandoffParagraphs({
  escalation,
  owner,
  ownerId,
}: {
  escalation: TaskEscalation;
  owner: string | null;
  ownerId: string | null;
}) {
  const presence = usePersonPresence(ownerId)?.status ?? null;
  const paragraphs = listHandoffParagraphs(escalation, { owner, presence, now: Date.now() });
  return (
    <div className='flex flex-col gap-3 text-xs'>
      {paragraphs.map((paragraph) => (
        <section key={paragraph.label} className='flex flex-col gap-px'>
          <h3 className='font-medium text-fg-4'>{paragraph.label}</h3>
          <p className='text-fg-3'>{paragraph.text}</p>
        </section>
      ))}
    </div>
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
  return (
    <Panel
      persistId={resolveOverviewPanelId(task, 'handoff')}
      title={HANDOFF_TITLE[readOnly ? 'teammate' : 'owner']}
      icon='IconMegaphone'
    >
      <HandoffParagraphs escalation={task.escalation} owner={owner} ownerId={readOnly ? ownerId : null} />
    </Panel>
  );
}
