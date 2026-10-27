import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  CODE_LIMITS,
  DomainError,
  type FileChanged,
  type FileWrite,
  type FileWritten,
  resolveEditRefusal,
  selectTaskByReference,
} from '@shinsa/core';
import type { Engine } from '../runtime/engine.ts';
import { runCommandOrThrow } from '../shell/index.ts';
import type { Workspaces } from '../workspaces/index.ts';
import { readJsonObject } from './body.ts';
import { assertRepoPath, resolveWritableInside } from './paths.ts';
import type { ApiRoute } from './routes.ts';

function readText(value: unknown, name: string) {
  if (typeof value !== 'string') throw new DomainError('body_invalid', `${name} must be text.`);
  if (new TextEncoder().encode(value).length > CODE_LIMITS.blobBytes)
    throw new DomainError('file_too_large', 'Shinsa saves files up to 2 MB from the editor.');
  return value;
}

function readFileWrite(body: Record<string, unknown>): FileWrite {
  return {
    path: assertRepoPath(typeof body.path === 'string' ? body.path : null),
    content: readText(body.content, 'content'),
    base: body.base === null ? null : readText(body.base, 'base'),
  };
}

function readCurrent(absolute: string) {
  return existsSync(absolute) ? readFileSync(absolute, 'utf8') : null;
}

async function isChangedFromHead(root: string, path: string) {
  const status = await runCommandOrThrow(['git', 'status', '--porcelain=v1', '-z', '--', path], root, {
    env: { GIT_LITERAL_PATHSPECS: '1' },
  });
  return status.length > 0;
}

export function createEditRoutes(engine: Engine, workspaces: Workspaces): ApiRoute[] {
  async function respondWrite(reference: string, request: Request) {
    const task = selectTaskByReference(engine.state, reference);
    const repo = task?.repoId ? engine.state.repos[task.repoId] : undefined;
    if (!task || !repo) throw new DomainError('code_unavailable', 'This task has no code to edit.');
    const refusal = resolveEditRefusal(task);
    if (refusal || !task.worktreePath) throw new DomainError('edit_refused', refusal ?? '');
    const root = task.worktreePath;
    const edit = readFileWrite(await readJsonObject(request));
    const absolute = resolveWritableInside(root, edit.path);
    if (!absolute) throw new DomainError('path_invalid', 'That path leaves the working copy.');
    const disk: { current: string | null; written: boolean } = { current: null, written: false };
    await workspaces.resolve(task).writeEdit(repo, task, edit.path, () => {
      disk.current = readCurrent(absolute);
      if (disk.current !== edit.base) return false;
      mkdirSync(dirname(absolute), { recursive: true });
      writeFileSync(absolute, edit.content);
      disk.written = true;
      return true;
    });
    if (!disk.written) {
      const changed: FileChanged = {
        error: { code: 'file_changed', message: `${edit.path} changed on disk since the editor read it.` },
        content: disk.current,
      };
      return Response.json(changed, { status: 409 });
    }
    const changed = await isChangedFromHead(root, edit.path);
    await engine.dispatch(
      { type: 'task.record_edit', taskId: task.id, path: edit.path, changed },
      { id: `edit:${task.id}:${edit.path}:${Bun.hash(`${edit.base ?? ''}\0${edit.content}`).toString(36)}` }
    );
    const result: FileWritten = { path: edit.path, changed };
    return Response.json(result);
  }

  return [
    {
      method: 'POST',
      pattern: /^\/api\/tasks\/([^/]+)\/file$/,
      respond: ([, id = ''], request) => respondWrite(decodeURIComponent(id), request),
    },
  ];
}
