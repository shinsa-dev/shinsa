import type { UserCommand } from '../commands/index.ts';
import { HUMAN_ONLY_REPO_FIELDS, HUMAN_ONLY_SETTINGS } from '../domain/index.ts';

export type RequestOrigin = 'local' | 'remote';

export const LOCAL_ONLY_CODE = 'local_only';

export const LOCAL_ONLY_MESSAGE = 'Do this on the machine Shinsa runs on.';

function touchesAny(patch: object, fields: readonly string[]) {
  return fields.some((field) => Object.hasOwn(patch, field));
}

export function isLocalOnlyCommand(command: UserCommand) {
  switch (command.type) {
    case 'settings.change':
      return touchesAny(command.patch, HUMAN_ONLY_SETTINGS);
    case 'repo.update':
      return touchesAny(command.patch, HUMAN_ONLY_REPO_FIELDS);
    case 'task.bind_account':
      return true;
    default:
      return false;
  }
}

export function resolveLocalOnlyRefusal(origin: RequestOrigin, command: UserCommand) {
  return origin === 'remote' && isLocalOnlyCommand(command) ? LOCAL_ONLY_MESSAGE : null;
}
