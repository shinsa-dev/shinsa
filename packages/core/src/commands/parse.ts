import { Predicate, Result, Schema } from 'effect';
import { DomainError } from '../domain/errors.ts';
import { listIssueMessages } from '../domain/issues.ts';
import { type ParsedUserCommand, USER_COMMAND_TYPES, UserCommand } from './schema.ts';

const USER_COMMAND_TYPE_SET: ReadonlySet<string> = new Set(USER_COMMAND_TYPES);

const decodeUserCommand = Schema.decodeUnknownResult(UserCommand);

export function isUserCommandType(type: unknown): type is UserCommand['type'] {
  return Predicate.isString(type) && USER_COMMAND_TYPE_SET.has(type);
}

export function parseUserCommand(body: unknown): Result.Result<ParsedUserCommand, DomainError> {
  if (!Predicate.isObject(body)) {
    return Result.fail(new DomainError({ code: 'command_invalid', message: 'A command must be an object.' }));
  }
  if (!isUserCommandType(body.type)) {
    return Result.fail(new DomainError({ code: 'command_forbidden', message: 'Unknown command.' }));
  }
  return Result.mapError(
    decodeUserCommand(body),
    (error) => new DomainError({ code: 'command_invalid', message: listIssueMessages(error.issue).join(' ') })
  );
}
