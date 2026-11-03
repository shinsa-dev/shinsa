import { Schema } from 'effect';

export const JOIN_PATH = '/api/remote/teams/join';

export const PROJECTS_PATH = '/api/projects';

export const COMMANDS_PATH = '/api/commands';

export const PROJECTS_TIMEOUT = '4 seconds';

export const JoinedTeam = Schema.Struct({ teamId: Schema.String });
