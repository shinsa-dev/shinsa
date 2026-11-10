import { describe, expect, test } from 'bun:test';
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Effect, Fiber } from 'effect';
import { CodexRequestError } from '../../../../src/agents/providers/codex/client/schema.ts';
import { makeCodexClient } from '../../../../src/agents/providers/codex/client/service.ts';
import { createTempDir, until } from '../../../helpers/index.ts';

function createServer() {
  const dir = createTempDir();
  const path = join(dir, 'server');
  const received = join(dir, 'received');
  writeFileSync(received, '');
  writeFileSync(
    path,
    `#!/usr/bin/env bun
import { appendFileSync } from 'node:fs';
const out = (line) => process.stdout.write(line + '\\n');
out('not json');
out('[1, 2]');
out(JSON.stringify({ method: 'note', params: [1] }));
out(JSON.stringify({ id: 's1', method: 'ask/me', params: {} }));
out(JSON.stringify({ id: 99, result: {} }));
let buffer = '';
for await (const chunk of Bun.stdin.stream()) {
  buffer += new TextDecoder().decode(chunk);
  let index = buffer.indexOf('\\n');
  while (index >= 0) {
    const line = buffer.slice(0, index);
    buffer = buffer.slice(index + 1);
    index = buffer.indexOf('\\n');
    appendFileSync(${JSON.stringify(received)}, line + '\\n');
    const message = JSON.parse(line);
    if (message.method === 'echo') out(JSON.stringify({ id: message.id, result: message.params }));
    if (message.method === 'env') out(JSON.stringify({ id: message.id, result: { headless: process.env.PLAYWRIGHT_MCP_HEADLESS, browser: process.env.PLAYWRIGHT_MCP_CDP_ENDPOINT ?? null } }));
    if (message.method === 'refuse') out(JSON.stringify({ id: message.id, error: {} }));
    if (message.method === 'quit') {
      process.stderr.write('first\\n\\nbye from the server');
      process.stdout.write(JSON.stringify({ method: 'last' }));
      process.exit(3);
    }
  }
}
`
  );
  chmodSync(path, 0o755);
  return { path, cwd: dir, received: () => readFileSync(received, 'utf8') };
}

function createDeafServer() {
  const dir = createTempDir();
  const path = join(dir, 'server');
  writeFileSync(
    path,
    `#!/bin/sh
exec 0<&-
printf 'stopped reading' >&2
echo '{"method":"deaf"}'
exec sleep 30
`
  );
  chmodSync(path, 0o755);
  return { path, cwd: dir };
}

function failureOf<A, R>(effect: Effect.Effect<A, CodexRequestError, R>) {
  return effect.pipe(Effect.match({ onSuccess: () => 'answered', onFailure: (error) => error.message }));
}

describe('the app server client', () => {
  test('talks JSON-RPC over lines, skips noise and answers requests it has no handler for', async () => {
    const server = createServer();
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const client = yield* makeCodexClient(
            { path: server.path, cwd: server.cwd, browserEndpoint: 'ws://127.0.0.1:7446/browser/cdp/key' },
            { request: () => null }
          );
          expect(yield* client.request('echo', { value: 1 })).toEqual({ value: 1 });
          expect(yield* client.request('env', {})).toEqual({
            headless: 'true',
            browser: 'ws://127.0.0.1:7446/browser/cdp/key',
          });
          const refused = yield* client
            .request('refuse', {})
            .pipe(Effect.match({ onSuccess: () => null, onFailure: (error) => error }));
          expect(refused).toEqual(
            new CodexRequestError({ method: 'refuse', message: 'Codex refused the request.' })
          );
          yield* Effect.promise(() =>
            until('the unanswered request to be refused', () => server.received().includes('"id":"s1"'))
          );
          yield* client.close;
          yield* client.close;
          yield* client.exited;
        })
      )
    );
    expect(server.received()).toContain('No handler for this request.');
  });

  test('a server that exits fails every request and reports its last words once', async () => {
    const server = createServer();
    const notes: string[] = [];
    const exits: string[] = [];
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const client = yield* makeCodexClient(
            { path: server.path, cwd: server.cwd },
            { notification: (method) => notes.push(method), exit: (message) => exits.push(message) }
          );
          const pending = yield* Effect.forkChild(failureOf(client.request('never', {})));
          yield* Effect.forkChild(failureOf(client.request('quit', {})));
          expect(yield* Fiber.join(pending)).toBe('bye from the server');
          yield* client.exited;
          expect(yield* failureOf(client.request('echo', {}))).toBe('Codex’s app server has stopped.');
        })
      )
    );
    expect(exits).toEqual(['bye from the server']);
    expect(notes).toContain('note');
    expect(notes).toContain('last');
  });

  test('a server that stops reading is stopped, and its requests fail with its last words', async () => {
    const server = createDeafServer();
    const deaf = Promise.withResolvers<void>();
    const exits: string[] = [];
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const client = yield* makeCodexClient(
            { path: server.path, cwd: server.cwd },
            { notification: () => deaf.resolve(), exit: (message) => exits.push(message) }
          );
          yield* Effect.promise(() => deaf.promise);
          expect(yield* failureOf(client.request('echo', {}))).toBe('stopped reading');
          yield* client.exited;
        })
      )
    );
    expect(exits).toEqual(['stopped reading']);
  });
});

describe('the app server client as a scoped resource', () => {
  test('without handlers it refuses the server’s requests, ignores its notes and ends with its last words', async () => {
    const server = createServer();
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const client = yield* makeCodexClient({ path: server.path, cwd: server.cwd });
          expect(yield* client.request('echo', { value: 2 })).toEqual({ value: 2 });
          yield* Effect.promise(() =>
            until('the unanswered request to be refused', () => server.received().includes('"id":"s1"'))
          );
          const quit = yield* client
            .request('quit', {})
            .pipe(Effect.match({ onSuccess: () => 'answered', onFailure: (error) => error.message }));
          expect(quit).toBe('bye from the server');
          yield* client.exited;
        })
      )
    );
    expect(server.received()).toContain('No handler for this request.');
  });

  test('a request handler’s answer goes back to the server', async () => {
    const server = createServer();
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* makeCodexClient(
            { path: server.path, cwd: server.cwd },
            { request: () => Promise.resolve({ answered: true }) }
          );
          yield* Effect.promise(() =>
            until('the answer to reach the server', () => server.received().includes('"answered":true'))
          );
        })
      )
    );
  });

  test('a program that cannot start fails with a typed error', async () => {
    const missing = await Effect.runPromise(
      Effect.flip(Effect.scoped(makeCodexClient({ path: '/nonexistent/codex', cwd: createTempDir() })))
    );
    expect(missing).toBeInstanceOf(CodexRequestError);
    expect(missing.method).toBe('app-server');
  });
});
