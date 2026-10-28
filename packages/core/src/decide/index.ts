import { isAgentCommand, type ShinsaCommand } from '../commands/index.ts';
import { sealDraft } from '../state/draft.ts';
import type { ShinsaState } from '../state/project.ts';
import {
  bindAccount,
  changeUsageWait,
  recordAccountRemoved,
  recordProviderSignIn,
  recordSignedIn,
  resumeUsageWait,
  resumeUsageWaitNow,
} from './accounts.ts';
import {
  askQuestion,
  attachCheck,
  attachComparison,
  attachEvidence,
  completeFix,
  completePhase,
  noteProgress,
  proposePlan,
  removeEvidence,
  reportReview,
} from './agents.ts';
import { recordChecks } from './checks.ts';
import { recordCompaction } from './compaction.ts';
import { recordConfig } from './config.ts';
import { meterRun } from './costs.ts';
import { type DecideContext, Decider, type Decision } from './decider.ts';
import { assertDelegationScope, routeQuestion } from './delegations.ts';
import { releaseWaiting } from './dependencies.ts';
import { commitEdits, recordEdit } from './edits.ts';
import { answerGate, assertGatesStayOpen, assertHumanDecides } from './gates.ts';
import { enforceLiveness } from './liveness.ts';
import { syncMergeSteps, tickMergeStep } from './merge-steps.ts';
import {
  dropMessage,
  messageTask,
  receiveMessage,
  redeliverMessage,
  routeMessage,
  sendQueuedRound,
} from './messages.ts';
import { checkInNow, fireMonitor, waitFor } from './monitors.ts';
import { recordOnBehalfAction } from './on-behalf.ts';
import { applyOrchestration } from './orchestration.ts';
import { recordOverlaps } from './overlaps.ts';
import {
  recordHookFailure,
  recordPullRequest,
  recordPullRequestReadFailure,
  recordPush,
  recordPushRetry,
  recordShippingStep,
  recordUpdateConflict,
} from './pull-requests.ts';
import { changeRoundShipping, removeRound, startQueuedRounds, updateRound } from './rounds.ts';
import {
  assertCurrentAttempt,
  attemptRun,
  continueRun,
  dispatchRuns,
  endRun,
  interruptRun,
  linkRun,
  recordSessionLost,
} from './runs.ts';
import {
  deliverSchedule,
  enableSchedule,
  failSchedule,
  fireSchedule,
  removeOwnSchedule,
  removeSchedule,
  writeSchedule,
  writeUserSchedule,
} from './schedules.ts';
import { requestSecret } from './secrets.ts';
import {
  changeFocus,
  changeSettings,
  registerRepo,
  removeProject,
  removeRepo,
  updateRepo,
  writeProject,
} from './settings.ts';
import { recordDelivery, recordReshape } from './shapes.ts';
import { dismissSilence, recordSilence, snoozeSilence } from './silence.ts';
import { acceptSuggestion, dismissSuggestion, keepSuggestion, suggestTasks } from './suggestions.ts';
import {
  cancelTask,
  completeTask,
  createTask,
  failEffect,
  prioritizeTask,
  readyWorktree,
  removeWorktree,
  retryTaskCommand,
  triageTask,
  waitOnTasks,
} from './tasks.ts';

export type { DecideContext, Decision } from './decider.ts';
export { type MessageEffect, needsMessageKind, resolveMessageEffect } from './messages.ts';
export { type RoundRelease, resolveRoundRelease } from './rounds.ts';
export {
  CI_GRACE_MS,
  createPullRequestWatch,
  evaluatePullRequestWatch,
  isSamePullRequest,
  isSamePullRequestWatch,
  resolvePullRequestCi,
} from './watch.ts';

function apply(decider: Decider, command: ShinsaCommand) {
  switch (command.type) {
    case 'repo.register':
      return registerRepo(decider, command);
    case 'repo.update':
      return updateRepo(decider, command);
    case 'repo.remove':
      return removeRepo(decider, command);
    case 'project.write':
      return writeProject(decider, command);
    case 'project.remove':
      return removeProject(decider, command);
    case 'focus.change':
      return changeFocus(decider, command);
    case 'settings.change':
      return changeSettings(decider, command);
    case 'task.create':
      return createTask(decider, command);
    case 'task.triage':
      return triageTask(decider, command);
    case 'task.prioritize':
      return prioritizeTask(decider, command);
    case 'task.wait_on':
      return waitOnTasks(decider, command);
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
    case 'message.receive':
      return receiveMessage(decider, command);
    case 'message.route':
      return routeMessage(decider, command);
    case 'message.drop':
      return dropMessage(decider, command);
    case 'round.ship':
      return changeRoundShipping(decider, command);
    case 'round.update':
      return updateRound(decider, command);
    case 'round.remove':
      return removeRound(decider, command);
    case 'round.send':
      return sendQueuedRound(decider, command);
    case 'gate.answer':
      assertHumanDecides(decider);
      return answerGate(decider, command.gateId, command.decision, command.response, {
        ...(command.planVersion === undefined ? {} : { planVersion: command.planVersion }),
        ...(command.verdicts === undefined ? {} : { verdicts: command.verdicts }),
        ...(command.comments === undefined ? {} : { comments: command.comments }),
      });
    case 'merge_step.tick':
      return tickMergeStep(decider, command);
    case 'suggestion.accept':
      return acceptSuggestion(decider, command);
    case 'suggestion.dismiss':
      return dismissSuggestion(decider, command);
    case 'suggestion.keep':
      return keepSuggestion(decider, command);
    case 'monitor.check_in_now':
      return checkInNow(decider, command);
    case 'monitor.fire':
      return fireMonitor(decider, command);
    case 'run.meter':
      return meterRun(decider, command);
    case 'run.silence':
      return recordSilence(decider, command);
    case 'run.snooze_silence':
      return snoozeSilence(decider, command);
    case 'run.dismiss_silence':
      return dismissSilence(decider, command);
    case 'config.record':
      return recordConfig(decider, command);
    case 'agent.wait_for':
      return waitFor(decider, command);
    case 'agent.suggest_tasks':
      return suggestTasks(decider, command);
    case 'agent.deliver':
      return recordDelivery(decider, command);
    case 'agent.reshape':
      return recordReshape(decider, command);
    case 'worktree.ready':
      return readyWorktree(decider, command);
    case 'worktree.gone':
      return removeWorktree(decider, command);
    case 'task.record_edit':
      return recordEdit(decider, command);
    case 'task.commit_edits':
      return commitEdits(decider, command);
    case 'task.record_overlaps':
      return recordOverlaps(decider, command);
    case 'effect.fail':
      return failEffect(decider, command);
    case 'checks.record':
      return recordChecks(decider, command);
    case 'pull_request.record':
      return recordPullRequest(decider, command);
    case 'pull_request.record_push':
      return recordPush(decider, command);
    case 'pull_request.record_step':
      return recordShippingStep(decider, command);
    case 'pull_request.record_retry':
      return recordPushRetry(decider, command);
    case 'pull_request.record_update_conflict':
      return recordUpdateConflict(decider, command);
    case 'pull_request.record_hook_failure':
      return recordHookFailure(decider, command);
    case 'pull_request.read_failed':
      return recordPullRequestReadFailure(decider, command);
    case 'run.link':
      return linkRun(decider, command);
    case 'run.end':
      return endRun(decider, command);
    case 'run.attempt':
      return attemptRun(decider, command);
    case 'run.interrupt':
      return interruptRun(decider, command);
    case 'run.continue':
      return continueRun(decider, command);
    case 'run.record_lost_session':
      return recordSessionLost(decider, command);
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
      return routeQuestion(decider, command, askQuestion);
    case 'agent.attach_evidence':
      return attachEvidence(decider, command);
    case 'agent.attach_check':
      return attachCheck(decider, command);
    case 'agent.attach_comparison':
      return attachComparison(decider, command);
    case 'agent.remove_evidence':
      return removeEvidence(decider, command);
    case 'agent.note':
      return noteProgress(decider, command);
    case 'task.bind_account':
      return bindAccount(decider, command);
    case 'usage_wait.change':
      return changeUsageWait(decider, command);
    case 'usage_wait.resume_now':
      return resumeUsageWaitNow(decider, command);
    case 'usage_wait.resume':
      return resumeUsageWait(decider, command);
    case 'account.signed_in':
      return recordSignedIn(decider, command);
    case 'account.removed':
      return recordAccountRemoved(decider, command);
    case 'provider.record_sign_in':
      return recordProviderSignIn(decider, command);
    case 'agent.delegate':
    case 'agent.cancel_delegation':
    case 'agent.answer_delegation':
    case 'agent.acknowledge_delegation':
    case 'agent.create_task':
    case 'agent.split_task':
    case 'delegation.cancel':
    case 'delegation.record_delivery':
    case 'delegation.release':
    case 'delegation.wake_policy':
    case 'delegations.recover':
      return applyOrchestration(decider, command);
    case 'agent.set_schedule':
      return writeSchedule(decider, command);
    case 'agent.delete_schedule':
      return removeOwnSchedule(decider, command);
    case 'agent.request_secret':
      return requestSecret(decider, command);
    case 'schedule.enable':
      return enableSchedule(decider, command);
    case 'schedule.remove':
      return removeSchedule(decider, command);
    case 'schedule.write':
      return writeUserSchedule(decider, command);
    case 'schedule.fire':
      return fireSchedule(decider, command);
    case 'schedule.deliver':
      return deliverSchedule(decider, command);
    case 'schedule.fail':
      return failSchedule(decider, command);
    case 'run.compact':
      return recordCompaction(decider, command);
  }
}

export function decide(state: ShinsaState, command: ShinsaCommand, context: DecideContext): Decision {
  const decider = new Decider(state, context);
  if (isAgentCommand(command)) {
    assertCurrentAttempt(decider, command.runId, command.attemptId);
    assertDelegationScope(decider, command);
  }
  apply(decider, command);
  releaseWaiting(decider);
  syncMergeSteps(decider);
  startQueuedRounds(decider);
  syncMergeSteps(decider);
  enforceLiveness(decider);
  dispatchRuns(decider);
  assertGatesStayOpen(decider, state);
  if (context.onBehalf) recordOnBehalfAction(decider, command);
  const changes = sealDraft(decider.state);
  return {
    events: decider.events,
    effects: decider.effects,
    cancellations: decider.cancellations,
    state: decider.events.length > 0 ? decider.state : state,
    changes,
  };
}
