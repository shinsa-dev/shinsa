import {
  type ShinsaEvent,
  validateFeedbackReport,
  validateMemoryProposal,
  validateSuggestions,
  validateWait,
} from '@shinsa/core';
import { assertProtocol } from '../../handover.ts';
import { handleShapeTool } from '../shapes/handler.ts';
import type { ProcessToolCall } from './schema.ts';

function hasRunOut(events: ShinsaEvent[]) {
  return events.some((event) => event.type === 'monitor.ended' && event.status === 'exhausted');
}

function describeWait(count: number) {
  return count === 1 ? 'a minute' : `${count} minutes`;
}

export async function handleProcessTool(name: string, input: Record<string, unknown>, call: ProcessToolCall) {
  const { runId, attemptId } = call;
  switch (name) {
    case 'wait_for': {
      const wait = assertProtocol(validateWait(input));
      const events = await call.dispatch({ type: 'agent.wait_for', runId, attemptId, ...wait });
      if (hasRunOut(events))
        return 'Your wait ran out, so Shinsa asked the human what to do. Stop here without a closing message.';
      return `Shinsa will resume your session in ${describeWait(wait.checkInMinutes)} with your notes. Stop here without a closing message.`;
    }
    case 'suggest_tasks': {
      const suggestions = assertProtocol(validateSuggestions(input));
      await call.dispatch({ type: 'agent.suggest_tasks', runId, attemptId, suggestions });
      return 'Suggested. The human decides whether to add them. Carry on with your step.';
    }
    case 'remember': {
      const rule = assertProtocol(validateMemoryProposal(input));
      await call.dispatch({ type: 'agent.remember', runId, attemptId, ...rule });
      return 'Proposed. The human decides whether agents remember it. Carry on with your step.';
    }
    case 'report_feedback': {
      const report = assertProtocol(validateFeedbackReport(input));
      await call.dispatch({ type: 'agent.report_feedback', runId, attemptId, ...report });
      return 'Reported. The human reads it before it becomes a public issue. Carry on with your step.';
    }
    default:
      return handleShapeTool(name, input, call);
  }
}
