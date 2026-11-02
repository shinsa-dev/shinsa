import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  PREVIEW_ID_BYTES,
  PREVIEW_KEY_BYTES,
  PREVIEW_KEY_HEADER,
  resolvePreviewOrigin,
  serializeBase64Url,
} from '../packages/core/src/index.ts';
import { createSandboxCloud } from './sandbox-cloud.ts';

const ZONE = 'http://localhost:5999';

const PREVIEW_ID = serializeBase64Url(new Uint8Array(PREVIEW_ID_BYTES).fill(3));

const KEY = serializeBase64Url(new Uint8Array(PREVIEW_KEY_BYTES).fill(4));

const servers: ReturnType<typeof Bun.serve>[] = [];

const folders: string[] = [];

afterEach(() => {
  for (const server of servers.splice(0)) void server.stop(true);
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

function createFolder() {
  const folder = mkdtempSync(join(tmpdir(), 'shinsa-sandbox-cloud-'));
  folders.push(folder);
  return folder;
}

function serveMachine() {
  const server = Bun.serve({
    port: 0,
    fetch: (request) =>
      Response.json({
        path: new URL(request.url).pathname,
        key: request.headers.get(PREVIEW_KEY_HEADER),
        address: request.headers.get('cf-connecting-ip'),
      }),
  });
  servers.push(server);
  return server.port ?? 0;
}

describe('the sandbox’s stand-in for app.shinsa.dev', () => {
  test('serves a preview through the Worker’s own preview code to the machine’s local port', async () => {
    const port = serveMachine();
    const connectKey = serializeBase64Url(new Uint8Array(32).fill(5));
    const cloud = createSandboxCloud(createFolder(), new URL(ZONE).host, '1', [
      { id: 'studio', name: 'Studio', port, connectKey },
    ]);
    const origin = resolvePreviewOrigin({ instanceId: 'studio', previewId: PREVIEW_ID }, ZONE);
    const answer = await cloud.respond(
      new Request(`${origin}/docs`, { headers: { cookie: `__Host-shinsa_preview=${KEY}` } })
    );
    expect(answer.status).toBe(200);
    expect(await answer.json()).toEqual({
      path: `/__preview/${PREVIEW_ID}/docs`,
      key: KEY,
      address: '127.0.0.1',
    });
    const robots = await cloud.respond(new Request(`${origin}/robots.txt`));
    expect(await robots.text()).toBe('User-agent: *\nDisallow: /\n');
    expect((await cloud.respond(new Request('http://sandbox.test/tasks'))).status).toBe(404);
  });

  test('says a machine it does not know is gone, and a tunnel it cannot reach is offline', async () => {
    const cloud = createSandboxCloud(createFolder(), 'localhost:5998', '1', [
      { id: 'laptop', name: 'Laptop', port: 1, connectKey: serializeBase64Url(new Uint8Array(32)) },
    ]);
    const unknown = resolvePreviewOrigin(
      { instanceId: 'nowhere', previewId: PREVIEW_ID },
      'http://localhost:5998'
    );
    const cookie = { headers: { cookie: `__Host-shinsa_preview=${KEY}` } };
    expect((await cloud.respond(new Request(`${unknown}/`, cookie))).status).toBe(404);
    const laptop = resolvePreviewOrigin(
      { instanceId: 'laptop', previewId: PREVIEW_ID },
      'http://localhost:5998'
    );
    expect((await cloud.respond(new Request(`${laptop}/`, cookie))).status).toBe(503);
  });
});
