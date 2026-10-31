import { describe, expect, test } from 'bun:test';
import {
  type FilesCheckResponse,
  PUBLICATION_LIMITS,
  type PublicationResponse,
  REMOTE_PATHS,
  resolveInstanceRemovePath,
  resolveMachineFilePath,
  resolveMachinePublicationPath,
  resolveMachinePublicationRemovePath,
  resolveShareFilePath,
  resolveSharePath,
  SHARE_CODE_FILE,
  SHARE_DIFF_FILE,
  type SharedPublication,
  type SharedTask,
} from '@shinsa/core';
import { ORPHAN_FILE_AGE_MS } from '../src/shares.ts';
import { createHarness, type Harness, pairMachine, readJson } from './harness.ts';

const TASK_ID = '0192f0a0-0000-7000-8000-000000000001';

function sharedTask(taskId = TASK_ID, code = true) {
  return { task: { id: taskId, title: 'Fix the panel' }, code } as unknown as SharedTask;
}

async function hashOf(bytes: Uint8Array<ArrayBuffer>) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function setUp() {
  const harness = createHarness();
  const session = await harness.signIn('mona', 1);
  const machine = await pairMachine(harness, session);
  return { harness, session, machine: machine.machineToken, instanceId: machine.instanceId };
}

function upload(
  harness: Harness,
  machine: string,
  hash: string,
  bytes: Uint8Array<ArrayBuffer>,
  type: string
) {
  return harness.call(resolveMachineFilePath(hash), {
    method: 'POST',
    headers: { authorization: `Bearer ${machine}`, 'content-type': type },
    body: bytes,
  });
}

function publish(
  harness: Harness,
  machine: string,
  body: Record<string, unknown> = { shared: sharedTask(), files: [], newLink: false },
  taskId = TASK_ID
) {
  return harness.post(resolveMachinePublicationPath(taskId), body, { bearer: machine, sameOrigin: false });
}

async function readToken(response: Response) {
  const { url } = await readJson<PublicationResponse>(response);
  return url?.split('/share/')[1] ?? '';
}

async function uploadScreenshot(harness: Harness, machine: string) {
  const bytes = new TextEncoder().encode('png bytes');
  const hash = await hashOf(bytes);
  expect((await upload(harness, machine, hash, bytes, 'image/png')).status).toBe(200);
  return hash;
}

describe('publishing a shared task', () => {
  test('a first publication makes a link anyone can open, without signing in', async () => {
    const { harness, machine } = await setUp();
    const answer = await publish(harness, machine);
    expect(answer.status).toBe(200);
    const token = await readToken(answer);
    expect(token).toHaveLength(43);
    const read = await harness.call(resolveSharePath(token));
    expect(read.status).toBe(200);
    expect(read.headers.get('x-robots-tag')).toBe('noindex, nofollow, noarchive');
    expect(read.headers.get('cache-control')).toBe('no-store');
    expect(await readJson<SharedPublication>(read)).toEqual({
      shared: sharedTask(),
      files: [],
      updatedAt: harness.clock.now,
    });
  });

  test('a later publication keeps the link and only stores the token hash', async () => {
    const { harness, machine } = await setUp();
    const token = await readToken(await publish(harness, machine));
    const again = await publish(harness, machine, {
      shared: { ...sharedTask(), machine: 'Laptop' },
      files: [],
    });
    expect(await readJson<PublicationResponse>(again)).toEqual({ url: null });
    const read = await readJson<SharedPublication>(await harness.call(resolveSharePath(token)));
    expect(read.shared.machine).toBe('Laptop');
    const stored = harness.db.sqlite.query('SELECT link_token_hash FROM publications').get() as {
      link_token_hash: string;
    };
    expect(stored.link_token_hash).not.toContain(token);
    expect(stored.link_token_hash).toHaveLength(64);
  });

  test('a new link replaces the old one, which then answers as no longer shared', async () => {
    const { harness, machine } = await setUp();
    const first = await readToken(await publish(harness, machine));
    const second = await readToken(
      await publish(harness, machine, { shared: sharedTask(), files: [], newLink: true })
    );
    expect(second).not.toBe(first);
    const gone = await harness.call(resolveSharePath(first));
    expect(gone.status).toBe(404);
    expect(gone.headers.get('x-robots-tag')).toBe('noindex, nofollow, noarchive');
    expect(await gone.json()).toEqual({
      error: { code: 'share_not_found', message: 'This task is no longer shared, or the link is wrong.' },
    });
    expect((await harness.call(resolveSharePath(second))).status).toBe(200);
  });

  test('only a paired machine publishes, and never over another machine’s task', async () => {
    const { harness, session, machine } = await setUp();
    expect((await publish(harness, 'not-a-machine')).status).toBe(401);
    await publish(harness, machine);
    const other = await pairMachine(harness, session, 'Laptop');
    const stolen = await publish(harness, other.machineToken);
    expect(stolen.status).toBe(409);
    expect(await stolen.json()).toEqual({
      error: { code: 'publication_conflict', message: 'Another machine publishes this task.' },
    });
    const removed = await harness.post(
      resolveMachinePublicationRemovePath(TASK_ID),
      {},
      { bearer: other.machineToken, sameOrigin: false }
    );
    expect(removed.status).toBe(409);
  });

  test('refuses a publication that is not this task, or one too large to share', async () => {
    const { harness, machine } = await setUp();
    const wrong = await publish(harness, machine, { shared: sharedTask('another-task'), files: [] });
    expect(wrong.status).toBe(400);
    expect((await wrong.json()) as unknown).toEqual({
      error: { code: 'body_invalid', message: 'The publication must be the shared task with this task id.' },
    });
    expect((await publish(harness, machine, { shared: null, files: [] })).status).toBe(400);
    const large = await publish(harness, machine, {
      shared: { ...sharedTask(), padding: 'x'.repeat(PUBLICATION_LIMITS.bytes) },
      files: [],
    });
    expect(large.status).toBe(413);
  });

  test('refuses malformed file lists, a diff for a task that shares no code, and files not uploaded', async () => {
    const { harness, machine } = await setUp();
    const hash = 'a'.repeat(64);
    const cases: [unknown, number, string][] = [
      ['nope', 400, 'body_invalid'],
      [
        Array.from({ length: PUBLICATION_LIMITS.files + 1 }, (_, index) => ({ id: `f${index}`, hash })),
        400,
        'body_invalid',
      ],
      [[{ id: '../x', hash }], 400, 'body_invalid'],
      [
        [
          { id: 'a', hash },
          { id: 'a', hash },
        ],
        400,
        'body_invalid',
      ],
      [[{ id: 'a', hash: 'short' }], 400, 'body_invalid'],
      [[null], 400, 'body_invalid'],
      [[{ id: 'a', hash }], 409, 'file_missing'],
    ];
    for (const [files, status, code] of cases) {
      const answer = await publish(harness, machine, { shared: sharedTask(), files });
      expect(answer.status).toBe(status);
      expect(((await answer.json()) as { error: { code: string } }).error.code).toBe(code);
    }
    const diff = await publish(harness, machine, {
      shared: sharedTask(TASK_ID, false),
      files: [{ id: SHARE_DIFF_FILE, hash }],
    });
    expect(diff.status).toBe(400);
    expect(await diff.json()).toEqual({
      error: { code: 'code_refused', message: 'This task shares no code, so it cannot publish its changes.' },
    });
    const code = await publish(harness, machine, {
      shared: sharedTask(TASK_ID, false),
      files: [{ id: SHARE_CODE_FILE, hash }],
    });
    expect(code.status).toBe(400);
  });
});

describe('the files of a shared task', () => {
  test('a file is uploaded once by its hash and served only through a link that lists it', async () => {
    const { harness, machine } = await setUp();
    const hash = await uploadScreenshot(harness, machine);
    const check = await harness.post(
      REMOTE_PATHS.machineFilesCheck,
      { hashes: [hash, 'b'.repeat(64)] },
      { bearer: machine, sameOrigin: false }
    );
    expect(await readJson<FilesCheckResponse>(check)).toEqual({ missing: ['b'.repeat(64)] });
    const token = await readToken(
      await publish(harness, machine, { shared: sharedTask(), files: [{ id: 'shot-1', hash }] })
    );
    const read = await readJson<SharedPublication>(await harness.call(resolveSharePath(token)));
    expect(read.files).toEqual(['shot-1']);
    const file = await harness.call(resolveShareFilePath(token, 'shot-1'));
    expect(file.status).toBe(200);
    expect(await file.text()).toBe('png bytes');
    expect(file.headers.get('content-type')).toBe('image/png');
    expect(file.headers.get('content-security-policy')).toBe("default-src 'none'; sandbox");
    expect(file.headers.get('x-robots-tag')).toBe('noindex, nofollow, noarchive');
    expect(file.headers.get('x-content-type-options')).toBe('nosniff');
    expect((await harness.call(resolveShareFilePath(token, 'other'))).status).toBe(404);
    expect((await harness.call(resolveShareFilePath('wrong-token', 'shot-1'))).status).toBe(404);
  });

  test('a public task’s diff is a file like any other', async () => {
    const { harness, machine } = await setUp();
    const bytes = new TextEncoder().encode('diff --git a/x b/x');
    const hash = await hashOf(bytes);
    await upload(harness, machine, hash, bytes, 'text/plain; charset=utf-8');
    const token = await readToken(
      await publish(harness, machine, { shared: sharedTask(), files: [{ id: SHARE_DIFF_FILE, hash }] })
    );
    const diff = await harness.call(resolveShareFilePath(token, SHARE_DIFF_FILE));
    expect(await diff.text()).toBe('diff --git a/x b/x');
    expect(diff.headers.get('content-type')).toBe('text/plain');
  });

  test('refuses a file whose bytes do not match its hash, an unsafe type or too many bytes', async () => {
    const { harness, machine } = await setUp();
    const bytes = new TextEncoder().encode('<svg onload=alert(1)>');
    const hash = await hashOf(bytes);
    const svg = await upload(harness, machine, hash, bytes, 'image/svg+xml');
    expect(svg.status).toBe(415);
    expect(await svg.json()).toEqual({
      error: { code: 'file_type_refused', message: 'Only images, videos and plain text can be shared.' },
    });
    expect((await upload(harness, machine, hash, bytes, '')).status).toBe(415);
    const mismatch = await upload(harness, machine, 'c'.repeat(64), bytes, 'text/plain');
    expect(mismatch.status).toBe(400);
    expect(((await mismatch.json()) as { error: { code: string } }).error.code).toBe('hash_mismatch');
    expect((await upload(harness, machine, 'not-hex', bytes, 'text/plain')).status).toBe(400);
    const declared = await harness.call(resolveMachineFilePath(hash), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${machine}`,
        'content-type': 'text/plain',
        'content-length': String(PUBLICATION_LIMITS.fileBytes + 1),
      },
      body: bytes,
    });
    expect(declared.status).toBe(413);
    const large = new Uint8Array(PUBLICATION_LIMITS.fileBytes + 1);
    expect((await upload(harness, machine, await hashOf(large), large, 'text/plain')).status).toBe(413);
    expect(harness.bucket.size).toBe(0);
  });

  test('refuses a check of too many hashes, or of one that is not a hash', async () => {
    const { harness, machine } = await setUp();
    const many = Array.from({ length: PUBLICATION_LIMITS.checkHashes + 1 }, () => 'a'.repeat(64));
    const tooMany = await harness.post(
      REMOTE_PATHS.machineFilesCheck,
      { hashes: many },
      { bearer: machine, sameOrigin: false }
    );
    expect(tooMany.status).toBe(400);
    const notHash = await harness.post(
      REMOTE_PATHS.machineFilesCheck,
      { hashes: ['x'] },
      { bearer: machine, sameOrigin: false }
    );
    expect(notHash.status).toBe(400);
  });

  test('an unpublished file is cleared an hour after it was uploaded', async () => {
    const { harness, machine } = await setUp();
    const hash = await uploadScreenshot(harness, machine);
    await publish(harness, machine);
    expect(harness.bucket.size).toBe(1);
    harness.clock.now += ORPHAN_FILE_AGE_MS + 1;
    await publish(harness, machine);
    expect(harness.bucket.size).toBe(0);
    const check = await harness.post(
      REMOTE_PATHS.machineFilesCheck,
      { hashes: [hash] },
      { bearer: machine, sameOrigin: false }
    );
    expect(await readJson<FilesCheckResponse>(check)).toEqual({ missing: [hash] });
  });

  test('a file the bucket lost answers as no longer shared', async () => {
    const { harness, machine } = await setUp();
    const hash = await uploadScreenshot(harness, machine);
    const token = await readToken(
      await publish(harness, machine, { shared: sharedTask(), files: [{ id: 'shot-1', hash }] })
    );
    harness.bucket.clear();
    expect((await harness.call(resolveShareFilePath(token, 'shot-1'))).status).toBe(404);
  });
});

describe('stopping a share', () => {
  test('removing a publication ends its link and clears its files at once', async () => {
    const { harness, machine } = await setUp();
    const hash = await uploadScreenshot(harness, machine);
    const token = await readToken(
      await publish(harness, machine, { shared: sharedTask(), files: [{ id: 'shot-1', hash }] })
    );
    const removed = await harness.post(
      resolveMachinePublicationRemovePath(TASK_ID),
      {},
      { bearer: machine, sameOrigin: false }
    );
    expect(await removed.json()).toEqual({ ok: true });
    expect((await harness.call(resolveSharePath(token))).status).toBe(404);
    expect((await harness.call(resolveShareFilePath(token, 'shot-1'))).status).toBe(404);
    expect(harness.bucket.size).toBe(0);
    const again = await harness.post(
      resolveMachinePublicationRemovePath(TASK_ID),
      {},
      { bearer: machine, sameOrigin: false }
    );
    expect(again.status).toBe(200);
  });

  test('removing one publication keeps a file another task uploaded but has not listed yet', async () => {
    const { harness, machine } = await setUp();
    const shot = await uploadScreenshot(harness, machine);
    await publish(harness, machine, { shared: sharedTask(), files: [{ id: 'shot-1', hash: shot }] });
    const bytes = new TextEncoder().encode('another shot');
    const fresh = await hashOf(bytes);
    await upload(harness, machine, fresh, bytes, 'image/png');
    await harness.post(
      resolveMachinePublicationRemovePath(TASK_ID),
      {},
      { bearer: machine, sameOrigin: false }
    );
    expect(harness.bucket.size).toBe(1);
    const other = '0192f0a0-0000-7000-8000-000000000002';
    const written = await publish(
      harness,
      machine,
      { shared: sharedTask(other), files: [{ id: 'shot-2', hash: fresh }] },
      other
    );
    expect(written.status).toBe(200);
  });

  test('a machine paired again after its removal gets a new link for a task it shares', async () => {
    const { harness, session, machine, instanceId } = await setUp();
    const first = await readToken(await publish(harness, machine));
    await harness.post(resolveInstanceRemovePath(instanceId), {}, { session });
    const again = await pairMachine(harness, session, 'Studio');
    const second = await readToken(
      await publish(harness, again.machineToken, { shared: sharedTask(), files: [], newLink: false })
    );
    expect(second).toHaveLength(43);
    expect(second).not.toBe(first);
    expect((await harness.call(resolveSharePath(second))).status).toBe(200);
    expect((await harness.call(resolveSharePath(first))).status).toBe(404);
  });

  test('removing the machine removes every publication and file it made', async () => {
    const { harness, session, machine, instanceId } = await setUp();
    const hash = await uploadScreenshot(harness, machine);
    const token = await readToken(
      await publish(harness, machine, { shared: sharedTask(), files: [{ id: 'shot-1', hash }] })
    );
    await harness.post(resolveInstanceRemovePath(instanceId), {}, { session });
    expect((await harness.call(resolveSharePath(token))).status).toBe(404);
    expect(harness.bucket.size).toBe(0);
  });

  test('removing a machine with nothing shared touches no files', async () => {
    const { harness, session, instanceId } = await setUp();
    const removed = await harness.post(resolveInstanceRemovePath(instanceId), {}, { session });
    expect(removed.status).toBe(200);
  });
});

describe('the shared page', () => {
  test('is the web app, kept out of search engines', async () => {
    const { harness } = await setUp();
    const page = await harness.call('/share/some-token');
    expect(await page.text()).toBe('asset /share/some-token');
    expect(page.headers.get('x-robots-tag')).toBe('noindex, nofollow, noarchive');
    expect(page.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    const home = await harness.call('/');
    expect(home.headers.get('x-robots-tag')).toBeNull();
  });

  test('a share token writes nothing: no route takes a write by it, and no machine route accepts it', async () => {
    const { harness, machine } = await setUp();
    const token = await readToken(await publish(harness, machine));
    for (const path of [resolveSharePath(token), resolveShareFilePath(token, 'shot-1')]) {
      for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
        const answer = await harness.call(path, { method, body: '{}' });
        expect(answer.status).toBe(404);
      }
    }
    const asMachine = { bearer: token, sameOrigin: false };
    expect((await harness.post(resolveMachinePublicationPath(TASK_ID), {}, asMachine)).status).toBe(401);
    expect((await harness.post(resolveMachinePublicationRemovePath(TASK_ID), {}, asMachine)).status).toBe(
      401
    );
    expect((await harness.post(REMOTE_PATHS.machineFilesCheck, { hashes: [] }, asMachine)).status).toBe(401);
    expect(
      (await harness.post(REMOTE_PATHS.heartbeat, { localUrl: 'http://127.0.0.1:7446' }, asMachine)).status
    ).toBe(401);
    expect((await harness.call(resolveSharePath(token))).status).toBe(200);
  });
});
