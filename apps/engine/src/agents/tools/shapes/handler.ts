import {
  type ChangeProposalInput,
  type DeliveringStep,
  type ShinsaEvent,
  validateDelivery,
  validateReadReport,
  validateReshape,
} from '@shinsa/core';
import { assertProtocol, HANDED_OVER } from '../../handover.ts';
import type { ProcessToolCall } from '../process/schema.ts';

const DELIVERING_TOOLS = new Map<string, DeliveringStep>([
  ['answer', 'answer'],
  ['report_diagnosis', 'investigate'],
  ['submit_report', 'research'],
  ['report_outcome', 'operate'],
]);

const UNCHANGED = 'Those are the steps this task already has. Plan it with `propose_plan`.';

function hasReshaped(events: ShinsaEvent[]) {
  return events.some((event) => event.type === 'task.reshaped');
}

function withProposal(proposal: ChangeProposalInput | null) {
  return proposal ? { proposal } : {};
}

export async function handleShapeTool(name: string, input: Record<string, unknown>, call: ProcessToolCall) {
  const { runId, attemptId } = call;
  const step = DELIVERING_TOOLS.get(name);
  if (step) {
    const { body, reply, proposal } = assertProtocol(validateDelivery(step, input));
    await call.dispatch({
      type: 'agent.deliver',
      runId,
      attemptId,
      step,
      body,
      ...(reply ? { reply } : {}),
      ...withProposal(proposal),
    });
    return HANDED_OVER;
  }
  if (name === 'report_read') {
    const read = assertProtocol(validateReadReport(input));
    await call.dispatch({ type: 'agent.report_read', runId, attemptId, ...read });
    return HANDED_OVER;
  }
  if (name === 'reshape_task') {
    const reshape = assertProtocol(validateReshape(input));
    const events = await call.dispatch({ type: 'agent.reshape', runId, attemptId, ...reshape });
    return hasReshaped(events) ? HANDED_OVER : UNCHANGED;
  }
  return null;
}
