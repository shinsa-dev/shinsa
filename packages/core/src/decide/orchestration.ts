import type { CommandOf } from '../commands/index.ts';
import { createCourierTask, splitTask } from './couriers.ts';
import type { Decider } from './decider.ts';
import {
  acknowledgeDelegation,
  answerDelegation,
  cancelDelegation,
  cancelDelegationByUser,
  changeWakePolicy,
  recordDelivered,
  recordUndelivered,
  recoverDeliveries,
  requestDelegation,
} from './delegations.ts';

type OrchestrationCommand = CommandOf<
  | 'agent.delegate'
  | 'agent.cancel_delegation'
  | 'agent.answer_delegation'
  | 'agent.acknowledge_delegation'
  | 'agent.create_task'
  | 'agent.split_task'
  | 'delegation.cancel'
  | 'delegation.record_delivery'
  | 'delegation.release'
  | 'delegation.wake_policy'
  | 'delegations.recover'
>;

export function applyOrchestration(decider: Decider, command: OrchestrationCommand) {
  switch (command.type) {
    case 'agent.delegate':
      return requestDelegation(decider, command);
    case 'agent.cancel_delegation':
      return cancelDelegation(decider, command);
    case 'agent.answer_delegation':
      return answerDelegation(decider, command);
    case 'agent.acknowledge_delegation':
      return acknowledgeDelegation(decider, command);
    case 'agent.create_task':
      return createCourierTask(decider, command);
    case 'agent.split_task':
      return splitTask(decider, command);
    case 'delegation.cancel':
      return cancelDelegationByUser(decider, command);
    case 'delegation.record_delivery':
      return recordDelivered(decider, command);
    case 'delegation.release':
      return recordUndelivered(decider, command);
    case 'delegation.wake_policy':
      return changeWakePolicy(decider, command);
    case 'delegations.recover':
      return recoverDeliveries(decider);
  }
}
