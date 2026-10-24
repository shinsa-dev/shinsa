import { TooltipLabel } from '@shinsa/ui/components/tooltip';
import * as React from 'react';
import { UsageBar } from '@/components/accounts/usage-bar.tsx';
import { UsagePercent } from '@/components/accounts/usage-percent.tsx';
import { Hint } from '@/components/overlays/hint.tsx';
import { type ContextMeterView, resolveContextMeter, selectContextNotice } from '@/lib/chat/context.ts';
import { connection } from '@/lib/connection/socket.ts';

export function ContextGauge({ meter }: { meter: ContextMeterView }) {
  return (
    <Hint
      label={
        <span className='whitespace-nowrap'>
          {meter.tokens}
          <TooltipLabel> · {meter.label}</TooltipLabel>
        </span>
      }
    >
      <span role='img' aria-label={meter.label} className='flex w-fit items-center gap-1.5 px-1.5'>
        <UsageBar row={meter} className='w-10' />
        <UsagePercent percent={meter.percent} className='text-2xs' />
      </span>
    </Hint>
  );
}

export function ContextMeter({ runIds }: { runIds: string[] }) {
  const notice = React.useSyncExternalStore(connection.subscribeTranscripts, () =>
    selectContextNotice(runIds.map((runId) => connection.selectTranscript(runId)))
  );
  const meter = resolveContextMeter(notice);
  if (!meter) return null;
  return <ContextGauge meter={meter} />;
}
