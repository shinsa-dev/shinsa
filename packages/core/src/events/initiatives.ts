import type {
  Initiative,
  InitiativeMilestone,
  InitiativeReport,
  InitiativeTeamMember,
  TeamInitiativeRef,
} from '../domain/initiatives.ts';

export type InitiativeEventBody =
  | { type: 'initiative.written'; initiative: Initiative }
  | { type: 'initiative.removed'; initiativeId: string }
  | { type: 'task.initiative_changed'; taskId: string; initiativeId: string | null; phaseId: string | null }
  | { type: 'task.team_initiative_changed'; taskId: string; teamInitiative: TeamInitiativeRef | null }
  | {
      type: 'initiative.team_members_recorded';
      initiativeId: string;
      teamId: string;
      members: InitiativeTeamMember[];
    }
  | { type: 'initiative.milestones_queued'; initiativeId: string; milestones: InitiativeMilestone[] }
  | { type: 'initiative.lead_woken'; initiativeId: string; runId: string }
  | { type: 'initiative.reported'; initiativeId: string; report: InitiativeReport };
