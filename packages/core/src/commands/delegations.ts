import type { DelegateRole, DelegationIsolation, DelegationMode, DelegationWake } from '../domain/index.ts';

export type DelegationUserCommand = { type: 'delegation.cancel'; runId: string };

export type DelegationAgentCommand =
  | {
      type: 'agent.delegate';
      runId: string;
      requestKey: string;
      title: string;
      brief: string;
      role: DelegateRole;
      mode: DelegationMode;
      isolation: DelegationIsolation;
      baseCommit: string | null;
      provider: string | null;
      model: string | null;
    }
  | { type: 'agent.cancel_delegation'; runId: string; childRunId: string }
  | { type: 'agent.answer_delegation'; runId: string; childRunId: string; answer: string }
  | { type: 'agent.acknowledge_delegation'; runId: string; childRunId: string }
  | {
      type: 'agent.create_task';
      runId: string;
      requestKey: string;
      request: string;
      repoId: string | null;
      thisWaits: boolean;
      forkOf?: string;
    }
  | { type: 'agent.split_task'; runId: string; requests: string[]; thisWaits: boolean };

export type DelegationSystemCommand =
  | { type: 'delegation.record_delivery'; runId: string; generation: number; items: string[] }
  | { type: 'delegation.release'; runId: string; generation: number | null; items: string[] }
  | { type: 'delegation.wake_policy'; runId: string; wake: DelegationWake }
  | { type: 'delegations.recover' };
