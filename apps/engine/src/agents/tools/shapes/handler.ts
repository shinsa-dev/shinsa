import {
  type ChangeProposalInput,
  type ShinsaEvent,
  validateDelivery,
  validateReadReport,
  validateReshape,
} from '@shinsa/core';
import { Effect } from 'effect';
import { HANDED_OVER } from '../../handover.ts';
import { assertToolInput } from '../attempts.ts';
import type { ProcessToolCall } from '../process/schema.ts';
import { DELIVERING_TOOLS, UNCHANGED_SHAPE } from './schema.ts';

export const handleShapeTool = Effect.fn('ShapeTool.handle')(function* (
  name: string,
  input: Record<string, unknown>,
  call: ProcessToolCall
) {
  const { runId, attemptId } = call;
  const hasReshaped = (events: ShinsaEvent[]) => events.some((event) => event.type === 'task.reshaped');
  const withProposal = (proposal: ChangeProposalInput | null) => (proposal ? { proposal } : {});
  const step = DELIVERING_TOOLS.get(name);
  if (step) {
    const { body, reply, proposal, recommend, actions } = yield* assertToolInput(
      validateDelivery(step, input)
    );
    yield* call.dispatch({
      type: 'agent.deliver',
      runId,
      attemptId,
      step,
      body,
      ...(reply ? { reply } : {}),
      ...withProposal(proposal),
      ...(recommend ? { recommend } : {}),
      ...(actions.length > 0 ? { actions } : {}),
    });
    return HANDED_OVER;
  }
  if (name === 'report_read') {
    const read = yield* assertToolInput(validateReadReport(input));
    yield* call.dispatch({ type: 'agent.report_read', runId, attemptId, ...read });
    return HANDED_OVER;
  }
  if (name === 'reshape_task') {
    const reshape = yield* assertToolInput(validateReshape(input));
    const events = yield* call.dispatch({ type: 'agent.reshape', runId, attemptId, ...reshape });
    return hasReshaped(events) ? HANDED_OVER : UNCHANGED_SHAPE;
  }
  return null;
});
