import type { UserCommand } from '@shinsa/core';
import { createEngineCalls } from '../../src/cli/client/index.ts';
import { readArgv, type SurfaceClient, type SurfaceSpec, selectSpec } from '../../src/surface/index.ts';
import type { Display } from '../../src/terminal/index.ts';
import { createStyle, UNICODE_SYMBOLS } from '../../src/terminal/style.ts';

type Responder = unknown | ((path: string, body?: unknown) => unknown);

export interface FakeClient {
  client: SurfaceClient;
  reads: string[];
  posts: { path: string; body: unknown }[];
  sent: UserCommand[];
}

export const BASE = 'http://127.0.0.1:5180';

export function createFakeClient(
  responses: Record<string, Responder> = {},
  taskId: string | null = null,
  handle: string | null = null
): FakeClient {
  const reads: string[] = [];
  const posts: { path: string; body: unknown }[] = [];
  const sent: UserCommand[] = [];
  const answer = async (request: Request) => {
    const url = new URL(request.url);
    const path = `${url.pathname}${url.search}`;
    const text = await request.text();
    const body: unknown = text ? JSON.parse(text) : undefined;
    if (request.method === 'GET') reads.push(path);
    else posts.push({ path, body });
    if (!(path in responses)) {
      return Response.json(
        { error: { code: 'not_found', message: `No canned answer for ${path}` } },
        { status: 404 }
      );
    }
    const responder = responses[path];
    return Response.json(typeof responder === 'function' ? responder(path, body) : responder);
  };
  const client: SurfaceClient = {
    base: BASE,
    api: createEngineCalls({
      base: BASE,
      fetch: Object.assign(
        (input: string | URL | Request, init?: RequestInit) => answer(new Request(String(input), init)),
        {
          preconnect: fetch.preconnect,
        }
      ),
    }),
    send: (command) => {
      sent.push(command);
      return Promise.resolve({ ok: true, taskId, ...(handle ? { handle } : {}) });
    },
  };
  return { client, reads, posts, sent };
}

export function findSpec(words: string[]): SurfaceSpec {
  const found = selectSpec(words);
  if (!found || found.rest.length > 0) throw new Error(`No spec ${words.join(' ')}`);
  return found.spec;
}

export function runSpec(fake: FakeClient, words: string[], display?: Display) {
  const found = selectSpec(words);
  if (!found) throw new Error(`No spec for ${words.join(' ')}`);
  return found.spec.run(fake.client, readArgv(found.spec.fields, found.rest).values, display);
}

export const COLOR_DISPLAY: Display = {
  style: createStyle({ color: true, symbols: UNICODE_SYMBOLS }),
  width: null,
};

export function createTaskDetail(overrides: Record<string, unknown> = {}) {
  return {
    task: {
      id: 'task-123',
      title: 'Fix the tab scroll',
      status: 'Building',
      decision: null,
      repo: 'app',
      ...((overrides.task as object | undefined) ?? {}),
    },
    gates: [],
    mergeSteps: [],
    text: 'Fix the tab scroll\nBuilding.',
    suggestions: [],
    ...overrides,
  };
}

export function createAccountsSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    accounts: [
      {
        id: 'acc-1',
        email: 'me@example.com',
        organization: null,
        plan: 'max',
        origin: 'login',
        isDefault: true,
        paused: false,
        switchAt: null,
        signIn: 'signed_in',
        signInDetail: null,
        usage: { windows: [{ label: 'Session', usedPercent: 41.6, resetsAt: 0 }], detail: null },
        spentUntil: null,
        runs: 0,
      },
    ],
    login: null,
    imports: [],
    ...overrides,
  };
}
