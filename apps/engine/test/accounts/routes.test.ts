import { describe, expect, test } from 'bun:test';
import { DomainError } from '@shinsa/core';
import type { Accounts } from '../../src/accounts/index.ts';
import { createAccountRoutes } from '../../src/accounts/routes.ts';
import type { ApiRoute } from '../../src/http/routes.ts';

function createAccounts() {
  const calls: [string, ...unknown[]][] = [];
  const record =
    (name: string, answer: unknown) =>
    (...args: unknown[]) => {
      calls.push([name, ...args]);
      return answer;
    };
  const accounts = {
    snapshot: record('snapshot', { accounts: [], defaultAccountId: null }),
    refresh: record('refresh', Promise.resolve({ refreshed: true })),
    refreshUsage: record('refreshUsage', Promise.resolve({ usageRefreshed: true })),
    startLogin: record('startLogin', Promise.resolve({ id: 'login-1', phase: 'starting' })),
    submitLoginCode: record('submitLoginCode', { submitted: true }),
    cancelLogin: record('cancelLogin', { cancelled: true }),
    importAccount: record('importAccount', Promise.resolve({ id: 'acc-2' })),
    update: record('update', { updated: true }),
    remove: record('remove', Promise.resolve({ removed: true })),
  };
  const routes = createAccountRoutes(accounts as unknown as Accounts);
  return { routes, calls };
}

function findRoute(routes: ApiRoute[], method: string, path: string) {
  const route = routes.find((candidate) => candidate.method === method && candidate.pattern.test(path));
  if (!route) throw new Error(`no route for ${method} ${path}`);
  return { route, match: route.pattern.exec(path) as RegExpExecArray };
}

async function post(routes: ApiRoute[], path: string, body: string) {
  const { route, match } = findRoute(routes, 'POST', path);
  const response = await route.respond(
    match,
    new Request(`http://localhost${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    })
  );
  return response.json();
}

async function expectRefusal(promise: Promise<unknown>, code: string, message: string) {
  const error = await promise.then(
    () => null,
    (reason: unknown) => reason
  );
  expect(error).toBeInstanceOf(DomainError);
  expect(error).toMatchObject({ code, message });
}

describe('account routes', () => {
  test('GET /api/accounts answers the snapshot', async () => {
    const { routes, calls } = createAccounts();
    const { route, match } = findRoute(routes, 'GET', '/api/accounts');
    const response = await route.respond(match, new Request('http://localhost/api/accounts'));
    expect(await response.json()).toEqual({ accounts: [], defaultAccountId: null });
    expect(calls).toEqual([['snapshot']]);
  });

  test('each POST passes its fields to the accounts and answers with the result', async () => {
    const { routes, calls } = createAccounts();
    expect(await post(routes, '/api/accounts/refresh', '{}')).toEqual({ refreshed: true });
    expect(await post(routes, '/api/accounts/refresh', '{"scope":"usage"}')).toEqual({
      usageRefreshed: true,
    });
    expect(await post(routes, '/api/accounts/login', '{"accountId":"acc-1"}')).toEqual({
      id: 'login-1',
      phase: 'starting',
    });
    expect(await post(routes, '/api/accounts/login/code', '{"loginId":"login-1","code":"abc#def"}')).toEqual({
      submitted: true,
    });
    expect(await post(routes, '/api/accounts/login/cancel', '{"loginId":"login-1"}')).toEqual({
      cancelled: true,
    });
    expect(await post(routes, '/api/accounts/import', '{"origin":"cswap","email":"me@x.dev"}')).toEqual({
      id: 'acc-2',
    });
    expect(
      await post(routes, '/api/accounts/update', '{"accountId":"acc-1","patch":{"paused":true}}')
    ).toEqual({
      updated: true,
    });
    expect(await post(routes, '/api/accounts/remove', '{"accountId":"acc-1"}')).toEqual({ removed: true });
    expect(calls).toEqual([
      ['refresh'],
      ['refreshUsage'],
      ['startLogin', 'acc-1'],
      ['submitLoginCode', 'login-1', 'abc#def'],
      ['cancelLogin', 'login-1'],
      ['importAccount', 'cswap', 'me@x.dev'],
      ['update', 'acc-1', { paused: true }],
      ['remove', 'acc-1'],
    ]);
  });

  test('signing in without an account adds a new one', async () => {
    const { routes, calls } = createAccounts();
    await post(routes, '/api/accounts/login', '{}');
    await post(routes, '/api/accounts/login', '{"accountId":null}');
    expect(calls).toEqual([
      ['startLogin', null],
      ['startLogin', null],
    ]);
  });

  test('an account id that is empty or not a string is refused', async () => {
    const { routes, calls } = createAccounts();
    for (const body of ['{"accountId":""}', '{"accountId":7}']) {
      await expectRefusal(
        post(routes, '/api/accounts/login', body),
        'account_invalid',
        'Name the account to sign in to.'
      );
    }
    expect(calls).toEqual([]);
  });

  test('a body that is not JSON or not an object is refused before anything runs', async () => {
    const { routes, calls } = createAccounts();
    await expectRefusal(
      post(routes, '/api/accounts/refresh', '{'),
      'body_invalid',
      'The request body is not valid JSON.'
    );
    for (const body of ['null', '[1]', '"text"']) {
      await expectRefusal(
        post(routes, '/api/accounts/remove', body),
        'body_invalid',
        'The request body must be an object.'
      );
    }
    expect(calls).toEqual([]);
  });

  test('routes match their whole path only', () => {
    const { routes } = createAccounts();
    const paths = ['refresh', 'login', 'login/code', 'login/cancel', 'import', 'update', 'remove'];
    expect(
      routes
        .filter((route) => route.method === 'POST')
        .map((route) => paths.find((path) => route.pattern.test(`/api/accounts/${path}`)))
    ).toEqual(paths);
    expect(routes.some((route) => route.pattern.test('/api/accounts/login/code/extra'))).toBe(false);
  });
});
