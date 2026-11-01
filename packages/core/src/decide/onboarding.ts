import type { CommandOf } from '../commands/index.ts';
import { DomainError } from '../domain/errors.ts';
import { selectWelcomeTask, WELCOME_TASK } from '../domain/onboarding.ts';
import { resolveNextHandle } from '../state/project.ts';
import type { Decider } from './decider.ts';

export function recordWelcome(decider: Decider, command: CommandOf<'onboarding.welcome'>) {
  const body = command.body.trim();
  if (body.length === 0) throw new DomainError('welcome_invalid', 'The welcome needs a summary.');
  if (selectWelcomeTask(decider.state.tasks)) {
    throw new DomainError('welcome_recorded', 'The welcome task is already there.');
  }
  const taskId = decider.context.newId();
  decider.emit({
    type: 'task.created',
    taskId,
    request: WELCOME_TASK.request,
    repoId: null,
    priority: 'normal',
    planFirst: false,
    origin: WELCOME_TASK.origin,
    mode: 'ask',
    auto: { shape: false, start: false, priority: false },
  });
  decider.emit({
    type: 'task.triaged',
    taskId,
    title: WELCOME_TASK.title,
    repoId: null,
    projectId: null,
    handle: resolveNextHandle(decider.state, null),
    size: 'small',
    branch: WELCOME_TASK.branch,
    decisions: { shape: null, start: null, priority: null },
  });
  decider.emit({ type: 'task.delivered', taskId, step: 'answer', body, runId: null });
  decider.stage(taskId, 'done', 'setup is finished');
  return taskId;
}
