export type TeamUserCommand =
  | { type: 'project.add_to_team'; projectId: string; teamId: string }
  | { type: 'project.remove_from_team'; projectId: string; teamId: string };
