import { Option } from 'effect';
import type { Task } from './types.ts';

export const WELCOME_TASK = {
  origin: 'onboarding',
  title: 'Welcome to Shinsa',
  request: 'Set up Shinsa on this Mac.',
  branch: 'onboarding/welcome',
} as const;

export function selectWelcomeTask(tasks: Record<string, Task>): Option.Option<Task> {
  return Option.fromNullishOr(Object.values(tasks).find((task) => task.origin === WELCOME_TASK.origin));
}
