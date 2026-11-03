import { DAY_MS, HOUR_MS, MINUTE_MS, type Turnaround, type TurnaroundMedian } from '@shinsa/core';
import { formatCount } from '@/lib/format/count.ts';
import type { ShippingTile } from './shipping.ts';
import { formatPercent } from './usage.ts';

export const TURNAROUND_SECTION = 'Turnaround';

export const TURNAROUND_DESCRIPTION =
  'Medians of finished rounds, leaving out snoozes, the backlog, usage limits and waits on other tasks. A wait on you counts by your own hours: in full while you were active, less at night and not at all while you were away.';

export function formatTurnaround(ms: number) {
  if (ms < HOUR_MS) return `${Math.max(1, Math.round(ms / MINUTE_MS))}m`;
  if (ms < DAY_MS) {
    const minutes = Math.round(ms / MINUTE_MS);
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
  }
  return `${(ms / DAY_MS).toFixed(1).replace(/\.0$/, '')}d`;
}

function formatMedian(median: TurnaroundMedian) {
  return median.median === null ? 'None' : formatTurnaround(median.median);
}

function describeRounds(median: TurnaroundMedian) {
  return median.count === 0 ? 'No finished rounds' : `Over ${formatCount(median.count, 'round', 'rounds')}`;
}

export function listTurnaroundTiles(turnaround: Turnaround): ShippingTile[] {
  const { startToFinish, agentTime, yourTurnaround, waitingShare } = turnaround;
  return [
    {
      key: 'start-to-finish',
      label: 'Start to finish',
      value: formatMedian(startToFinish),
      detail: describeRounds(startToFinish),
    },
    {
      key: 'your-turnaround',
      label: 'Your turnaround',
      value: formatMedian(yourTurnaround),
      detail:
        yourTurnaround.count === 0
          ? 'No answered waits'
          : `Over ${formatCount(yourTurnaround.count, 'wait', 'waits')}`,
    },
    {
      key: 'agent-time',
      label: 'Agent time',
      value: formatMedian(agentTime),
      detail: describeRounds(agentTime),
    },
    {
      key: 'waiting-share',
      label: 'Waiting on you',
      value: formatPercent(waitingShare),
      detail: waitingShare === null ? 'No finished rounds' : 'Of round time',
    },
  ];
}
