import { describeCount, type Turnaround, type TurnaroundMedian } from '@shinsa/core';
import { formatPercent } from '@/lib/format/count.ts';
import { formatTurnaround } from '@/lib/format/time.ts';
import type { ShippingTile } from './shipping.ts';

export const TURNAROUND_SECTION = 'Turnaround';

export const TURNAROUND_DESCRIPTION =
  'Medians of finished rounds, leaving out snoozes, the backlog, usage limits and waits on other tasks. A wait on you counts by your own hours: in full while you were active, less at night and not at all while you were away.';

function formatMedian(median: TurnaroundMedian) {
  return median.median === null ? 'None' : formatTurnaround(median.median);
}

function describeRounds(median: TurnaroundMedian) {
  return median.count === 0 ? 'No finished rounds' : `Over ${describeCount(median.count, 'round', 'rounds')}`;
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
          : `Over ${describeCount(yourTurnaround.count, 'wait', 'waits')}`,
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
