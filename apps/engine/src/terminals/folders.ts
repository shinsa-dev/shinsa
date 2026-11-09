import { DomainError } from '@shinsa/core';
import { Effect } from 'effect';
import { isFolder } from '../files/probe.ts';
import { FOLDER_GONE_MESSAGE } from './schema.ts';

export const assertFolderPresent = Effect.fn('Terminals.assertFolderPresent')(function* (path: string) {
  if (yield* isFolder(path)) return;
  return yield* new DomainError({ code: 'terminal_place_missing', message: FOLDER_GONE_MESSAGE });
});
