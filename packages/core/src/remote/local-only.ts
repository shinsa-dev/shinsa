import { Option } from 'effect';
import type { UserCommand } from '../commands/index.ts';
import { HUMAN_ONLY_SETTINGS, OWNER_ONLY_REPO_FIELDS } from '../domain/index.ts';

export type RequestOrigin = 'local' | 'owner' | 'remote';

export const LOCAL_ONLY_MESSAGE = 'Do this on the machine Shinsa runs on.';

export const OWNER_ONLY_CODE = 'not_owner';

export const OWNER_ONLY_MESSAGE = 'Only this machine’s owner can do this from another device.';

function touchesAny(patch: object, fields: readonly string[]) {
  return fields.some((field) => Object.hasOwn(patch, field));
}

export function isOwnerOnlyCommand(command: UserCommand) {
  switch (command.type) {
    case 'settings.change':
      return touchesAny(command.patch, HUMAN_ONLY_SETTINGS);
    case 'repo.update':
      return touchesAny(command.patch, OWNER_ONLY_REPO_FIELDS);
    case 'task.bind_account':
      return true;
    case 'task.retry':
      return command.account !== undefined;
    default:
      return false;
  }
}

export function resolveOwnerOnlyRefusal(origin: RequestOrigin, command: UserCommand) {
  return origin === 'remote' && isOwnerOnlyCommand(command)
    ? Option.some(OWNER_ONLY_MESSAGE)
    : Option.none<string>();
}
