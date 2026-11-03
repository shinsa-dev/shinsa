import { describeCount } from '../chat/text.ts';

export function describeUnblocks(count: number) {
  return `unblocks ${describeCount(count, 'other task', 'other tasks')}`;
}
