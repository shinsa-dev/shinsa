import { ShimmeringText } from '@shinsa/ui/components/shimmering-text';
import { Truncate } from '@shinsa/ui/components/truncate';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import { ExpandRow, FoldLine, ROW_INDENT, SHIMMER_LINE } from '@/components/chat/chat-line.tsx';
import { ImageStrip } from '@/components/chat/image-strip.tsx';
import { ToolDetail } from '@/components/chat/tool-detail.tsx';
import { DiffStats } from '@/components/text/diff-stats.tsx';
import { useCallImages } from '@/hooks/use-call-images.ts';
import type { ToolCall } from '@/lib/chat/timeline.ts';
import { resolveGroupKey, resolveGroupPhrase, resolveRunningLabel } from '@/lib/chat/tool-describe.ts';
import { resolveEditStats } from '@/lib/chat/tool-output.ts';
import { selectLatestCall } from '@/lib/chat/turns.ts';
import { type DisclosurePersistId, useDisclosure, useDisclosureScope } from '@/lib/preferences/disclosure.ts';

const COLLAPSE_AFTER = 5;

function ToolLabel({ call }: { call: ToolCall }) {
  const { verb, target, code, scope } = call.description;
  return (
    <span className='flex min-w-0 items-baseline gap-1.5'>
      <span className='shrink-0'>{verb}</span>
      {target && (
        <Truncate className={cn('font-normal text-fg-4', code && 'font-mono text-2xs')}>{target}</Truncate>
      )}
      {scope && <Truncate className='shrink font-normal text-fg-2'>· {scope}</Truncate>}
    </span>
  );
}

function resolveToolMeta(call: ToolCall) {
  if (!call.failed) return null;
  if (call.recovery === 'retried') return 'Retried';
  if (call.recovery === 'retrying') return 'Retrying';
  return <span className='text-red-text'>Failed</span>;
}

export function ToolRow({ call, live }: { call: ToolCall; live: boolean }) {
  const running = live && call.result === null;
  const images = useCallImages(call);
  const stats = React.useMemo(() => resolveEditStats(call.tool), [call.tool]);
  const broken = call.failed && call.recovery === null;
  const persistId = useDisclosureScope('tool', call.key);
  return (
    <ExpandRow
      persistId={persistId}
      icon={broken ? 'IconExclamationCircle' : call.description.icon}
      iconClassName={broken ? 'text-red-text' : undefined}
      label={
        running ? (
          <ShimmeringText text={resolveRunningLabel(call.description)} className={SHIMMER_LINE} />
        ) : (
          <ToolLabel call={call} />
        )
      }
      meta={resolveToolMeta(call)}
      trailing={!call.failed && stats && <DiffStats {...stats} />}
      images={images}
    >
      <ToolDetail call={call} running={running} />
    </ExpandRow>
  );
}

export function ToolGroup({
  persistId,
  calls,
  live,
}: {
  persistId: DisclosurePersistId;
  calls: ToolCall[];
  live: boolean;
}) {
  const { open, toggle, replaceOpen } = useDisclosure(persistId, false);
  const [single] = calls;
  if (calls.length === 1 && single) return <ToolRow call={single} live={live} />;
  const failures = calls.filter((call) => call.failed && call.recovery === null).length;
  const current = live ? selectLatestCall(calls) : null;
  const running = live && calls.some((call) => call.result === null);
  const label = resolveGroupPhrase(calls.map((call) => resolveGroupKey(call.tool)));
  return (
    <div className='flex min-w-0 flex-col'>
      <FoldLine
        open={open}
        onToggle={toggle}
        label={running ? <ShimmeringText text={label} className={SHIMMER_LINE} /> : label}
        meta={failures > 0 && <span className='text-red-text'>{failures} failed</span>}
      />
      {!open && current && (
        <div className={cn('pt-3', ROW_INDENT)}>
          <ToolRow key={current.key} call={current} live={live} />
        </div>
      )}
      {!open && !current && (
        <ImageStrip images={calls.flatMap((call) => call.images)} className={cn('pt-2.5', ROW_INDENT)} />
      )}
      {open && (
        <div className='flex min-w-0 flex-col gap-3 pt-3'>
          {calls.map((call) => (
            <ToolRow key={call.key} call={call} live={live} />
          ))}
          {calls.length > COLLAPSE_AFTER && (
            <FoldLine open onToggle={() => replaceOpen(false)} label='Collapse' />
          )}
        </div>
      )}
    </div>
  );
}
