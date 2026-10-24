import { Icon } from '@shinsa/ui/components/icon';
import { TooltipLabel } from '@shinsa/ui/components/tooltip';
import { Hint } from '@/components/overlays/hint.tsx';
import { InfoLine } from '@/components/overlays/info-popover.tsx';
import { type NoticeGroup, resolveNoticeLine } from '@/lib/chat/notices.ts';
import type { QuietNoticeKind, TimelineItemOf } from '@/lib/chat/timeline.ts';

function NoticeGroups({ groups }: { groups: NoticeGroup[] }) {
  return (
    <span className='flex min-w-56 flex-col gap-2'>
      {groups.map((group) => (
        <span key={group.title} className='flex flex-col gap-px'>
          <TooltipLabel>{group.title}</TooltipLabel>
          {group.lines.map((line) => (
            <InfoLine
              key={line.name}
              label={line.name}
              value={<TooltipLabel className='tabular-nums'>{line.tokens}</TooltipLabel>}
            />
          ))}
          {group.more && <TooltipLabel>{group.more}</TooltipLabel>}
        </span>
      ))}
    </span>
  );
}

export function NoticeLine({ item }: { item: TimelineItemOf<QuietNoticeKind> }) {
  const { icon, text, hint, groups } = resolveNoticeLine(item);
  return (
    <Hint label={groups ? <NoticeGroups groups={groups} /> : hint}>
      <div className='flex min-w-0 cursor-default items-center gap-1.5 self-start text-2xs text-fg-2'>
        <Icon name={icon} className='size-3.5 shrink-0' />
        <span className='truncate'>{text}</span>
      </div>
    </Hint>
  );
}
