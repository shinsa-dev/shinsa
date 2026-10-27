import { ExpandRow } from '@/components/chat/chat-line.tsx';
import { type NoticeGroup, resolveNoticeLine } from '@/lib/chat/notices.ts';
import type { QuietNoticeKind, TimelineItemOf } from '@/lib/chat/timeline.ts';
import { useDisclosureScope } from '@/lib/preferences/disclosure.ts';

function NoticeGroups({ groups }: { groups: NoticeGroup[] }) {
  return (
    <div className='flex min-w-0 flex-col gap-3 text-xs'>
      {groups.map((group) => (
        <div key={group.title} className='flex min-w-0 flex-col gap-px'>
          <span className='text-2xs text-fg-2'>{group.title}</span>
          <ul className='flex w-full min-w-0 max-w-80 flex-col'>
            {group.lines.map((line) => (
              <li key={line.name} className='flex min-w-0 items-baseline justify-between gap-4'>
                <span className='min-w-0 truncate text-fg-4'>{line.name}</span>
                <span className='shrink-0 text-fg-2 tabular-nums'>{line.tokens}</span>
              </li>
            ))}
          </ul>
          {group.more && <span className='text-fg-2'>{group.more}</span>}
        </div>
      ))}
    </div>
  );
}

export function NoticeLine({ item }: { item: TimelineItemOf<QuietNoticeKind> }) {
  const { icon, label, meta, detail, groups } = resolveNoticeLine(item);
  const persistId = useDisclosureScope('notice', item.key);
  return (
    <ExpandRow persistId={persistId} icon={icon} label={label} meta={meta}>
      <p className='text-fg-3 text-xs'>{detail}</p>
      {groups && <NoticeGroups groups={groups} />}
    </ExpandRow>
  );
}
