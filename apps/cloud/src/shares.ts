import {
  type FilesCheckResponse,
  isShareCodeFile,
  isShareFileId,
  isShareFileType,
  PUBLICATION_LIMITS,
  type PublicationFile,
  type PublicationResponse,
  resolveShareUrl,
  type SharedPublication,
  type SharedTask,
} from '@shinsa/core';
import { createToken, resolveTokenHash } from './crypto.ts';
import type { InstanceRow } from './database.ts';
import { resolveFileKey } from './files.ts';
import { CloudError, readJsonFields, respondJson } from './http.ts';
import { findMachine } from './instances.ts';
import type { CloudWorld } from './world.ts';

export const ORPHAN_FILE_AGE_MS = 60 * 60_000;

export const NOINDEX = 'noindex, nofollow, noarchive';

const FILE_HASH = /^[0-9a-f]{64}$/;

const NOT_SHARED = 'This task is no longer shared, or the link is wrong.';

async function resolveBytesHash(bytes: ArrayBuffer) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function assertFileHash(hash: string) {
  if (!FILE_HASH.test(hash))
    throw new CloudError('body_invalid', 'A file is named by the SHA-256 of its bytes, in hex.', 400);
}

function readSharedTask(value: unknown, taskId: string): SharedTask {
  const task = (value as { task?: { id?: unknown } } | null)?.task;
  if (value === null || typeof value !== 'object' || task?.id !== taskId)
    throw new CloudError('body_invalid', 'The publication must be the shared task with this task id.', 400);
  return value as SharedTask;
}

function readPublicationFiles(value: unknown, shared: SharedTask): PublicationFile[] {
  if (!Array.isArray(value) || value.length > PUBLICATION_LIMITS.files)
    throw new CloudError(
      'body_invalid',
      `A publication lists at most ${PUBLICATION_LIMITS.files} files.`,
      400
    );
  const seen = new Set<string>();
  return value.map((item: unknown) => {
    const { id, hash } = (item ?? {}) as { id?: unknown; hash?: unknown };
    if (typeof id !== 'string' || !isShareFileId(id) || seen.has(id) || typeof hash !== 'string')
      throw new CloudError('body_invalid', 'Each file needs a unique id and the hash of its bytes.', 400);
    assertFileHash(hash);
    if (isShareCodeFile(id) && !shared.code)
      throw new CloudError(
        'code_refused',
        'This task shares no code, so it cannot publish its changes.',
        400
      );
    seen.add(id);
    return { id, hash };
  });
}

async function findOwnPublication(machine: InstanceRow, taskId: string, world: CloudWorld) {
  const row = await world.store.selectPublication(taskId);
  if (row && row.instance_id !== machine.id)
    throw new CloudError('publication_conflict', 'Another machine publishes this task.', 409);
  return row;
}

async function assertFilesUploaded(machine: InstanceRow, files: PublicationFile[], world: CloudWorld) {
  const stored = new Set(await world.store.listInstanceFileHashes(machine.id));
  const missing = files.filter((file) => !stored.has(file.hash)).map((file) => file.id);
  if (missing.length > 0)
    throw new CloudError('file_missing', `Upload these files first: ${missing.join(', ')}.`, 409);
}

async function removeOrphanFiles(
  machine: InstanceRow,
  world: CloudWorld,
  createdBefore: number,
  only: ReadonlySet<string> | null = null
) {
  const orphans = await world.store.listOrphanFileHashes(machine.id, createdBefore);
  const hashes = only ? orphans.filter((hash) => only.has(hash)) : orphans;
  if (hashes.length === 0) return;
  await world.files.remove(hashes.map((hash) => resolveFileKey(machine.id, hash)));
  await world.store.removeFiles(machine.id, hashes);
}

async function resolveLink(keptHash: string | null) {
  if (keptHash) return { token: null, hash: keptHash };
  const token = createToken();
  return { token, hash: await resolveTokenHash(token) };
}

export async function respondPublicationWrite(request: Request, taskId: string, world: CloudWorld) {
  const machine = await findMachine(request, world);
  const fields = await readJsonFields(request, PUBLICATION_LIMITS.bytes);
  const shared = readSharedTask(fields.shared, taskId);
  const files = readPublicationFiles(fields.files, shared);
  const existing = await findOwnPublication(machine, taskId, world);
  await assertFilesUploaded(machine, files, world);
  const link = await resolveLink(fields.newLink === true ? null : (existing?.link_token_hash ?? null));
  await world.store.writePublication({
    taskId,
    instanceId: machine.id,
    body: JSON.stringify(shared),
    linkTokenHash: link.hash,
    updatedAt: world.now(),
    files,
  });
  await removeOrphanFiles(machine, world, world.now() - ORPHAN_FILE_AGE_MS);
  const answer: PublicationResponse = {
    url: link.token ? resolveShareUrl(world.config.origin, link.token) : null,
  };
  return respondJson(answer);
}

export async function respondPublicationRemove(request: Request, taskId: string, world: CloudWorld) {
  const machine = await findMachine(request, world);
  if (!(await findOwnPublication(machine, taskId, world))) return respondJson({ ok: true });
  const listed = new Set(await world.store.listPublicationFileHashes(taskId));
  await world.store.removePublication(taskId);
  await removeOrphanFiles(machine, world, world.now() + 1, listed);
  return respondJson({ ok: true });
}

export async function respondFilesCheck(request: Request, world: CloudWorld) {
  const machine = await findMachine(request, world);
  const { hashes } = await readJsonFields(request);
  if (!Array.isArray(hashes) || hashes.length > PUBLICATION_LIMITS.checkHashes)
    throw new CloudError(
      'body_invalid',
      `Check at most ${PUBLICATION_LIMITS.checkHashes} hashes at once.`,
      400
    );
  for (const hash of hashes) assertFileHash(String(hash));
  const stored = new Set(await world.store.listInstanceFileHashes(machine.id));
  const answer: FilesCheckResponse = { missing: (hashes as string[]).filter((hash) => !stored.has(hash)) };
  return respondJson(answer);
}

export async function respondFileUpload(request: Request, hash: string, world: CloudWorld) {
  const machine = await findMachine(request, world);
  assertFileHash(hash);
  const contentType = (request.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  if (!isShareFileType(contentType))
    throw new CloudError('file_type_refused', 'Only images, videos and plain text can be shared.', 415);
  if (Number(request.headers.get('content-length') ?? 0) > PUBLICATION_LIMITS.fileBytes)
    throw new CloudError('body_too_large', 'The file is too large to share.', 413);
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > PUBLICATION_LIMITS.fileBytes)
    throw new CloudError('body_too_large', 'The file is too large to share.', 413);
  if ((await resolveBytesHash(bytes)) !== hash)
    throw new CloudError('hash_mismatch', 'The file does not match its hash.', 400);
  await world.files.put(resolveFileKey(machine.id, hash), bytes, contentType);
  await world.store.recordFile(
    { instance_id: machine.id, hash, content_type: contentType, size: bytes.byteLength },
    world.now()
  );
  return respondJson({ ok: true });
}

function respondNotShared() {
  return respondJson({ error: { code: 'share_not_found', message: NOT_SHARED } }, 404, {
    'x-robots-tag': NOINDEX,
  });
}

export async function respondShare(token: string, world: CloudWorld) {
  const row = await world.store.selectSharedPublication(await resolveTokenHash(token));
  if (!row) return respondNotShared();
  const answer: SharedPublication = {
    shared: JSON.parse(row.body) as SharedTask,
    files: await world.store.listPublicationFileIds(row.task_id),
    updatedAt: row.updated_at,
  };
  return respondJson(answer, 200, { 'x-robots-tag': NOINDEX });
}

export async function respondShareFile(token: string, fileId: string, world: CloudWorld) {
  const row = await world.store.selectSharedFile(await resolveTokenHash(token), fileId);
  if (!row) return respondNotShared();
  const stored = await world.files.select(resolveFileKey(row.instance_id, row.hash));
  if (!stored) return respondNotShared();
  return new Response(stored.body, {
    headers: {
      'content-type': row.content_type,
      'content-length': String(row.size),
      'content-disposition': 'inline',
      'content-security-policy': "default-src 'none'; sandbox",
      'cache-control': 'private, max-age=300',
      'x-robots-tag': NOINDEX,
    },
  });
}
