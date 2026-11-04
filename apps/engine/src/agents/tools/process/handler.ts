import {
  type ShinsaEvent,
  validateFeedbackReport,
  validateMemoryProposal,
  validateSuggestions,
  validateWait,
} from '@shinsa/core';
import { Effect } from 'effect';
import { assertToolInput } from '../attempts.ts';
import { handleShapeTool } from '../shapes/handler.ts';
import type { ProcessToolCall } from './schema.ts';

export const handleProcessTool = Effect.fn('ProcessTool.handle')(function* (
  name: string,
  input: Record<string, unknown>,
  call: ProcessToolCall
) {
  const { runId, attemptId } = call;
  const hasRunOut = (events: ShinsaEvent[]) =>
    events.some((event) => event.type === 'monitor.ended' && event.status === 'exhausted');
  const describeWait = (count: number) => (count === 1 ? 'a minute' : `${count} minutes`);

  const waitFor = Effect.fn('ProcessTool.waitFor')(function* () {
    const wait = yield* assertToolInput(validateWait(input));
    const events = yield* call.dispatch({ type: 'agent.wait_for', runId, attemptId, ...wait });
    if (hasRunOut(events))
      return 'Your wait ran out, so Shinsa asked the human what to do. Stop here without a closing message.';
    return `Shinsa will resume your session in ${describeWait(wait.checkInMinutes)} with your notes. Stop here without a closing message.`;
  });

  const suggestTasks = Effect.fn('ProcessTool.suggestTasks')(function* () {
    const suggestions = yield* assertToolInput(validateSuggestions(input));
    yield* call.dispatch({ type: 'agent.suggest_tasks', runId, attemptId, suggestions });
    return 'Suggested. The human decides whether to add them. Carry on with your step.';
  });

  const remember = Effect.fn('ProcessTool.remember')(function* () {
    const rule = yield* assertToolInput(validateMemoryProposal(input));
    yield* call.dispatch({ type: 'agent.remember', runId, attemptId, ...rule });
    return 'Proposed. The human decides whether agents remember it. Carry on with your step.';
  });

  const reportFeedback = Effect.fn('ProcessTool.reportFeedback')(function* () {
    const report = yield* assertToolInput(validateFeedbackReport(input));
    yield* call.dispatch({ type: 'agent.report_feedback', runId, attemptId, ...report });
    return 'Reported. The human reads it before it becomes a public issue. Carry on with your step.';
  });

  switch (name) {
    case 'wait_for':
      return yield* waitFor();
    case 'suggest_tasks':
      return yield* suggestTasks();
    case 'remember':
      return yield* remember();
    case 'report_feedback':
      return yield* reportFeedback();
    default:
      return yield* handleShapeTool(name, input, call);
  }
});
