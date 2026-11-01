import type { CommandOf } from '../commands/index.ts';
import { DomainError, type Project } from '../domain/index.ts';
import type { Decider } from './decider.ts';

function assertHumanTeams(decider: Decider) {
  if (!decider.context.onBehalf) return;
  throw new DomainError(
    'human_only',
    'Only the human decides which projects a team sees. Tell them they can choose it in Settings → Teams.'
  );
}

function findTeamProject(decider: Decider, projectId: string) {
  const project = decider.state.projects[projectId];
  if (!project) throw new DomainError('project_not_found', `No project ${projectId}`);
  return project;
}

function writeTeamIds(decider: Decider, project: Project, teamIds: string[]) {
  const { teamIds: _previous, ...rest } = project;
  decider.emit({ type: 'project.written', project: teamIds.length > 0 ? { ...rest, teamIds } : rest });
}

export function addProjectToTeam(decider: Decider, command: CommandOf<'project.add_to_team'>) {
  assertHumanTeams(decider);
  const project = findTeamProject(decider, command.projectId);
  const teamIds = project.teamIds ?? [];
  if (teamIds.includes(command.teamId)) return;
  writeTeamIds(decider, project, [...teamIds, command.teamId]);
}

export function removeProjectFromTeam(decider: Decider, command: CommandOf<'project.remove_from_team'>) {
  assertHumanTeams(decider);
  const project = findTeamProject(decider, command.projectId);
  const teamIds = project.teamIds ?? [];
  if (!teamIds.includes(command.teamId)) return;
  writeTeamIds(
    decider,
    project,
    teamIds.filter((teamId) => teamId !== command.teamId)
  );
}
