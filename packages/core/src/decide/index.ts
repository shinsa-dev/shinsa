import type { ShinsaCommand } from '../commands/index.ts';
import type { ShinsaState } from '../state/project.ts';
import {
  askQuestion,
  attachEvidence,
  completeFix,
  completePhase,
  noteProgress,
  proposePlan,
  reportReview,
} from './agents.ts';
import { type DecideContext, Decider, type Decision } from './decider.ts';
import { releaseQueued } from './dependencies.ts';
import { recordChecks } from './fixes.ts';
import { answerGate } from './gates.ts';
import { enforceLiveness } from './liveness.ts';
import { messageTask, redeliverMessage } from './messages.ts';
import { recordPullRequest, recordPush } from './pull-requests.ts';
import { dispatchRuns, endRun, linkRun } from './runs.ts';
import {
  changeFocus,
  changeSettings,
  registerRepo,
  removeArea,
  removeRepo,
  updateRepo,
  writeArea,
  writeBriefing,
} from './settings.ts';
import {
  blockTask,
  cancelTask,
  completeTask,
  createTask,
  failEffect,
  prioritizeTask,
  readyWorktree,
  removeWorktree,
  retryTaskCommand,
  triageTask,
} from './tasks.ts';

export type { DecideContext, Decision } from './decider.ts';
export { resolveCurrentPhase } from './lifecycle.ts';
export { type Liveness, resolveLiveness } from './liveness.ts';

function apply(decider: Decider, command: ShinsaCommand) {
  switch (command.type) {
    case 'repo.register':
      return registerRepo(decider, command);
    case 'repo.update':
      return updateRepo(decider, command);
    case 'repo.remove':
      return removeRepo(decider, command);
    case 'area.write':
      return writeArea(decider, command);
    case 'area.remove':
      return removeArea(decider, command);
    case 'focus.change':
      return changeFocus(decider, command);
    case 'settings.change':
      return changeSettings(decider, command);
    case 'briefing.write':
      return writeBriefing(decider, command);
    case 'task.create':
      return createTask(decider, command);
    case 'task.triage':
      return triageTask(decider, command);
    case 'task.prioritize':
      return prioritizeTask(decider, command);
    case 'task.block':
      return blockTask(decider, command);
    case 'task.cancel':
      return cancelTask(decider, command);
    case 'task.complete':
      return completeTask(decider, command);
    case 'task.retry':
      return retryTaskCommand(decider, command);
    case 'task.message':
      return messageTask(decider, command);
    case 'message.deliver':
      return redeliverMessage(decider, command);
    case 'gate.answer':
      return answerGate(decider, command.gateId, command.decision, command.response);
    case 'worktree.ready':
      return readyWorktree(decider, command);
    case 'worktree.gone':
      return removeWorktree(decider, command);
    case 'effect.fail':
      return failEffect(decider, command);
    case 'checks.record':
      return recordChecks(decider, command);
    case 'pull_request.record':
      return recordPullRequest(decider, command);
    case 'pull_request.pushed':
      return recordPush(decider, command);
    case 'run.link':
      return linkRun(decider, command);
    case 'run.end':
      return endRun(decider, command);
    case 'runs.dispatch':
      return;
    case 'agent.propose_plan':
      return proposePlan(decider, command);
    case 'agent.complete_phase':
      return completePhase(decider, command);
    case 'agent.complete_fix':
      return completeFix(decider, command);
    case 'agent.report_review':
      return reportReview(decider, command);
    case 'agent.ask':
      return askQuestion(decider, command);
    case 'agent.attach_evidence':
      return attachEvidence(decider, command);
    case 'agent.note':
      return noteProgress(decider, command);
  }
}

export function decide(state: ShinsaState, command: ShinsaCommand, context: DecideContext): Decision {
  const decider = new Decider(state, context);
  apply(decider, command);
  releaseQueued(decider);
  enforceLiveness(decider);
  dispatchRuns(decider);
  return { events: decider.events, effects: decider.effects };
}
