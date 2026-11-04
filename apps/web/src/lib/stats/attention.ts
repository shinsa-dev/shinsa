import { describeCount, type TurnaroundMedian, type YourAttention } from '@shinsa/core';
import { formatPercent } from '@/lib/format/count.ts';
import { formatTurnaround } from '@/lib/format/time.ts';
import type { ShippingTile } from './shipping.ts';

export const ATTENTION_SECTION = 'Your attention';

export const ATTENTION_DESCRIPTION =
  'How many tasks you run at once, and how little each finished round needed from you. Your inputs are the gates you answered and the messages you sent. Tasks at once counts by your own hours and leaves out paused time.';

const NO_ROUNDS = 'No finished rounds';
const NO_TASKS = 'No tasks going';

function formatAmount(value: number | null) {
  return value === null ? 'None' : value.toLocaleString('en-US', { maximumFractionDigits: 1 });
}

function describeRounds(count: number) {
  return count === 0 ? NO_ROUNDS : `Over ${describeCount(count, 'round', 'rounds')}`;
}

function formatTimeMedian(median: TurnaroundMedian) {
  return median.median === null ? 'None' : formatTurnaround(median.median);
}

function describeShare(share: number | null, detail: string) {
  return share === null ? NO_ROUNDS : detail;
}

export function listAttentionTiles(attention: YourAttention): ShippingTile[] {
  const { tasksAtOnce, inputsPerRound, agentTimePerInput, approvedFirstTime } = attention;
  return [
    {
      key: 'tasks-at-once',
      label: 'Tasks at once',
      hint: 'The median number of tasks with a round going at the same time, weighted by your own hours. Paused time and time with nothing going are left out.',
      value: formatAmount(tasksAtOnce.median),
      detail: tasksAtOnce.median === null ? NO_TASKS : 'Median while busy',
    },
    {
      key: 'peak-at-once',
      label: 'Peak at once',
      hint: 'The most tasks that had a round going at the same moment in this range.',
      value: formatAmount(tasksAtOnce.peak),
      detail: tasksAtOnce.peak === null ? NO_TASKS : 'At one moment',
    },
    {
      key: 'inputs-per-round',
      label: 'Inputs per round',
      hint: 'The median number of gates you answered and messages you sent in each finished round.',
      value: formatAmount(inputsPerRound.median),
      detail: describeRounds(inputsPerRound.count),
    },
    {
      key: 'agent-time-per-input',
      label: 'Agent time per input',
      hint: 'The median of how long the agents worked in a round for each input it needed from you.',
      value: formatTimeMedian(agentTimePerInput),
      detail: describeRounds(agentTimePerInput.count),
    },
    {
      key: 'hands-off',
      label: 'Hands-off rounds',
      hint: 'The share of finished rounds where you only approved a plan, review or merge: no question, no message, no revision.',
      value: formatPercent(attention.handsOffShare),
      detail: describeShare(attention.handsOffShare, 'Only approvals'),
    },
    {
      key: 'with-question',
      label: 'Rounds with a question',
      hint: 'The share of finished rounds where an agent asked you a question or asked for a secret.',
      value: formatPercent(attention.questionShare),
      detail: describeShare(attention.questionShare, 'An agent asked you'),
    },
    {
      key: 'messages-per-round',
      label: 'Messages per round',
      hint: 'The average number of messages you sent to a task in each finished round.',
      value: formatAmount(attention.messagesPerRound),
      detail: attention.messagesPerRound === null ? NO_ROUNDS : 'On average, sent by you',
    },
    {
      key: 'approved-first-time',
      label: 'Approved first time',
      hint: 'The share of reviewed rounds where you approved the first review instead of asking for changes.',
      value: formatPercent(approvedFirstTime.share),
      detail:
        approvedFirstTime.count === 0
          ? 'No reviews'
          : `Over ${describeCount(approvedFirstTime.count, 'review', 'reviews')}`,
    },
  ];
}
