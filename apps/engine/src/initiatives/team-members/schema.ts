import type { InitiativeTeamMember } from '@shinsa/core';

export interface TeamMembersUpdate {
  initiativeId: string;
  teamId: string;
  previous: readonly InitiativeTeamMember[];
  members: InitiativeTeamMember[];
}
