import type { InitiativeTeamMember } from '../domain/initiatives.ts';

export type InitiativeAgentCommand = {
  type: 'agent.report_initiative';
  runId: string;
  narrative: string;
};

export type InitiativeSystemCommand =
  | { type: 'initiative.wake_lead'; initiativeId: string }
  | {
      type: 'initiative.record_team_members';
      initiativeId: string;
      teamId: string;
      members: InitiativeTeamMember[];
    };
