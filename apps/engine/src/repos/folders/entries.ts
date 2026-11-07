import { readdir } from 'node:fs/promises';
import { Effect } from 'effect';
import { selectErrnoCode } from '../../shell/errno.ts';
import { FolderUnreadable } from '../schema.ts';

export const listFolderEntries = (path: string) =>
  Effect.tryPromise({
    try: () => readdir(path, { withFileTypes: true }),
    catch: (error) => new FolderUnreadable({ path, code: selectErrnoCode(error) }),
  });
